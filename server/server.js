const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const winston = require('winston');
const cron = require('node-cron');
const path = require('path');

const TempDbManager = require('./TempDbManager');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || 'secretHash'; // должен быть захеширован bcrypt-ом
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'default_admin_token';

const mongoUser = process.env.MONGO_INITDB_ROOT_USERNAME || 'root';
const mongoPass = process.env.MONGO_INITDB_ROOT_PASSWORD || 'example';
const uri = `mongodb://${mongoUser}:${mongoPass}@localhost:27017/?authSource=admin`;
const client = new MongoClient(uri);

let db;
const metaCollectionName = 'meta';
const usersCollectionName = 'appUsers';

async function connectDB() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await client.connect();
      db = client.db('temp_dbs');
      await db.createCollection(metaCollectionName).catch(() => {});
      await db.createCollection(usersCollectionName).catch(() => {});
      logger.info('Подключено к MongoDB');
      // Проверим, есть ли админ, если нет — создадим
      const existingAdmin = await db.collection(usersCollectionName).findOne({ type: 'admin', username: ADMIN_USERNAME });
      if (!existingAdmin) {
        if (!ADMIN_PASSWORD_HASH) {
          logger.error('ADMIN_PASSWORD_HASH не задан в переменных окружения!');
          process.exit(1);
        }
        await db.collection(usersCollectionName).insertOne({
          username: ADMIN_USERNAME,
          passwordHash: ADMIN_PASSWORD_HASH,
          type: 'admin',
          createdAt: new Date(),
        });
        logger.info(`Админ-пользователь '${ADMIN_USERNAME}' создан`);
      }
      return;
    } catch (err) {
      logger.error(`Попытка ${attempt + 1} не удалась: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  logger.error('Не удалось подключиться к MongoDB после 10 попыток');
  process.exit(1);
}

// Passport конфигурация
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await db.collection(usersCollectionName).findOne({ username });
      if (!user) {
        return done(null, false, { message: 'Неверные данные' });
      }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return done(null, false, { message: 'Неверные данные' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }),
);

passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.collection(usersCollectionName).findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.urlencoded({ extended: false }));

function authorize(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('login'));

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
  }),
);

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.send(`Добро пожаловать, ${req.user.username}! Тип: ${req.user.type}`);
});

let tempDbManager;

app.get('/create_temp_db', authorize, async (req, res) => {
  try {
    const result = await tempDbManager.createTempDb();

    // Добавим пользователя в appUsers
    const tempUser = {
      username: result.username,
      passwordHash: await bcrypt.hash(result.password, 10),
      type: 'temp',
      dbName: result.dbName,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // например, 10 минут жизни
    };
    await db.collection(usersCollectionName).insertOne(tempUser);

    res.status(200).json(result);
  } catch (err) {
    logger.error(`Ошибка при создании БД: ${err.message}`);
    res.status(500).json({ error: 'Failed to create temp DB' });
  }
});

cron.schedule('* * * * *', async () => {
  try {
    await tempDbManager.cleanupExpired(10);

    // Удаляем просроченных пользователей
    const now = new Date();
    const deleteResult = await db
      .collection(usersCollectionName)
      .deleteMany({ type: 'temp', expiresAt: { $lte: now } });
    if (deleteResult.deletedCount > 0) {
      logger.info(`Удалено ${deleteResult.deletedCount} просроченных временных пользователей`);
    }
  } catch (err) {
    logger.error(`Ошибка cron-задачи: ${err.message}`);
  }
});

async function startServer() {
  await connectDB();
  tempDbManager = new TempDbManager(client, db, metaCollectionName, logger);
  app.listen(3000, () => {
    logger.info('Сервер запущен на порту 3000');
  });
}

startServer();

