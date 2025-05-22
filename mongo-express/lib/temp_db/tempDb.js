import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import winston from 'winston';
import cron from 'node-cron';
import TempDbManager from './TempDbManager.js';
import { mongoClient } from '../initAdminClient.js';

// Логирование
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Настройки
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'default_admin_token';
const metaCollectionName = 'meta';
const usersCollectionName = 'appUsers';

// Переменная для хранения TempDbManager
let tempDbManager = null;

// Middleware для авторизации
function authorize(req, res, next) {
  const authHeader = req.headers.authorization;
  logger.info(`Authorization header: ${authHeader}`);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Unauthorized: Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  if (token !== ADMIN_TOKEN) {
    logger.warn(`Forbidden: Invalid token ${token}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Инициализация TempDbManager
export async function initTempDb() {
  try {
    const db = mongoClient.db('temp_dbs');
    // Создаём коллекции, если они не существуют
    await db.createCollection(metaCollectionName).catch(err => logger.warn(`Failed to create meta collection: ${err.message}`));
    await db.createCollection(usersCollectionName).catch(err => logger.warn(`Failed to create appUsers collection: ${err.message}`));
    logger.info('Collections meta and appUsers ready');

    // Инициализируем TempDbManager
    tempDbManager = new TempDbManager(mongoClient, db, metaCollectionName, logger);
    logger.info('TempDbManager initialized');

    // Проверяем наличие админа
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || 'admin_hash';
    const existingAdmin = await db.collection(usersCollectionName).findOne({ type: 'admin', username: ADMIN_USERNAME });
    if (!existingAdmin) {
      if (!ADMIN_PASSWORD_HASH) {
        logger.error('ADMIN_PASSWORD_HASH not set in environment variables!');
        throw new Error('ADMIN_PASSWORD_HASH required');
      }
      await db.collection(usersCollectionName).insertOne({
        username: ADMIN_USERNAME,
        passwordHash: ADMIN_PASSWORD_HASH,
        type: 'admin',
        createdAt: new Date(),
      });
      logger.info(`Admin user '${ADMIN_USERNAME}' created`);
    }

    // Запускаем cron-задачу
    cron.schedule('* * * * *', async () => {
      try {
        await tempDbManager.cleanupExpired(10);
        const now = new Date();
        const deleteResult = await db
          .collection(usersCollectionName)
          .deleteMany({ type: 'temp', expiresAt: { $lte: now } });
        if (deleteResult.deletedCount > 0) {
          logger.info(`Deleted ${deleteResult.deletedCount} expired temporary users`);
        }
      } catch (err) {
        logger.error(`Cron job error: ${err.message}`);
      }
    });
    logger.info('Cron job for cleaning temporary databases started');
  } catch (err) {
    logger.error(`TempDb initialization error: ${err.message}`);
    throw err;
  }
}

// Маршрут для создания временной базы
export function tempDbRoutes(appRouter) {
  appRouter.get('/create_temp_db', authorize, async (req, res) => {
    try {
      if (!tempDbManager) {
        logger.error('TempDbManager not initialized');
        throw new Error('TempDbManager not initialized');
      }
      const result = await tempDbManager.createTempDb();
      const db = mongoClient.db('temp_dbs');
      // Добавляем пользователя в appUsers
      const tempUser = {
        username: result.username,
        passwordHash: await bcrypt.hash(result.password, 10),
        type: 'temp',
        dbName: result.dbName,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 минут жизни
      };
      await db.collection(usersCollectionName).insertOne(tempUser);
      logger.info(`Created temporary user: ${result.username}`);
      res.status(200).json(result);
    } catch (err) {
      logger.error(`Error creating temp DB: ${err.message}`);
      res.status(500).json({ error: 'Failed to create temp DB' });
    }
  });
}
