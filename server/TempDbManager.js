const { v4: uuidv4 } = require('uuid');

class TempDbManager {
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
  async createTempDb() {
    const dbName = `temp_db_${uuidv4().replace(/-/g, '')}`;
    const username = `user_${uuidv4().split('-')[0]}`;
    const password = uuidv4().split('-').pop();
    const adminDb = this.client.db('admin');

    await this.client.db(dbName).createCollection('initial');
    await adminDb.command({
      createUser: username,
      pwd: password,
      roles: [{ role: 'dbOwner', db: dbName }]
    });

    const meta = {
      dbName,
      username,
      password,
      createdAt: new Date()
    };
    await this.metaCollection.insertOne(meta);

    this.logger.info(`Создана временная БД: ${dbName} и пользователь ${username}`);
    return meta;
  }

  // Очистка устаревших баз и пользователей, старше указанного времени в минутах
  async cleanupExpired(minutes = 10) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const expired = await this.metaCollection.find({
      createdAt: { $lt: cutoff }
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

module.exports = TempDbManager;
