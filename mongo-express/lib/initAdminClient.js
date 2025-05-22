import mongodb from 'mongodb';

// Настройки
const mongoUser = process.env.MONGO_INITDB_ROOT_USERNAME || 'mongo';
const mongoPass = process.env.MONGO_INITDB_ROOT_PASSWORD || 'mongo';
const uri = `mongodb://${mongoUser}:${mongoPass}@localhost:27017/?authSource=admin`;
export const mongoClient = new mongodb.MongoClient(uri);

// Инициализация подключения
export async function initMongoClient() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await mongoClient.connect();
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt + 1} failed: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.error('Failed to connect to MongoDB after 10 attempts');
  process.exit(1);
}
