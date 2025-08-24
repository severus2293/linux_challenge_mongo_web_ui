import { v4 as uuidv4 } from 'uuid';
export default class TempDbManager {
  /**
   * @param {MongoClient} client - подключённый MongoClient
   * @param {Db} metaDb - база данных для метаданных
   * @param {string} metaCollectionName - имя коллекции с метаданными
   * @param {object} logger - логгер
   */
  constructor(client, metaDb, metaCollectionName, logger) {
    this.client = client;
    this.metaDb = metaDb;
    this.metaCollection = metaDb.collection(metaCollectionName);
    this.logger = logger;
  }

  // Создание временной базы данных и пользователя с правами dbOwner
  async createTempDb(ttlMinutes = 10) {
    const dbName = `temp_db_${uuidv4().replace(/-/g, '')}`;
    const username = `user_${uuidv4().split('-')[0]}`;
    const password = uuidv4().split('-').pop();
    const targetDb = this.client.db(dbName);

    await targetDb.createCollection('initial');
    await targetDb.command({
    createUser: username,
  	pwd: password,
  	roles: [{ role: 'readWrite', db: dbName }]
    });

    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const meta = {
      dbName,
      username,
      password,
      createdAt: new Date(),
      expiresAt,
      ttlMinutes
    };
    await this.metaCollection.insertOne(meta);

    this.logger.info(`Создана временная БД: ${dbName} и пользователь: ${username}, TTL: ${ttlMinutes} минут`);
    return meta;
  }

  // Очистка устаревших баз и пользователей
  async cleanupExpired() {
    const now = new Date();
    const expired = await this.metaCollection.find({
      expiresAt: { $lte: now }
    }).toArray();

    for (const entry of expired) {
      try {
        await this.client.db(entry.dbName).dropDatabase();
        await this.client.db('admin').command({ dropUser: entry.username });
        await this.metaCollection.deleteOne({ _id: entry._id });
        this.logger.info(`Удалена устаревшая БД: ${entry.dbName} и пользователь: ${entry.username}`);
      } catch (err) {
        this.logger.error(`Ошибка при удалении ${entry.dbName}: ${err.message}`);
      }
    }
  }
}
