import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import mongodb from 'mongodb';
import dbConnect from './db.js';
import { mongoClient } from './initAdminClient.js';

// Глобальный кеш для хранения подключений пользователей
global.mongoCache = global.mongoCache || {};
let cachedAdminHash = null;

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      if (!mongoClient) {
        return done(new Error('MongoDB client not initialized'));
      }

      // Пробуем авторизовать как админа
      const adminResult = await tryLoginAdmin(username, password);
      if (adminResult) return done(null, adminResult);

      // Пробуем авторизовать как обычного пользователя
      const userResult = await tryLoginUser(username, password);
      if (userResult) return done(null, userResult);

      // Ни один не подошёл
      return done(null, false, { message: 'Неверные данные' });
    } catch (err) {
      return done(err);
    }
  })
);

async function tryLoginAdmin(username, password) {
  const mongoUser = process.env.MONGO_INITDB_ROOT_USERNAME || 'mongo';
  const mongoPass = process.env.MONGO_INITDB_ROOT_PASSWORD || 'mongo';

  if (username !== mongoUser) return null;

  if (!cachedAdminHash) {
    cachedAdminHash = await bcrypt.hash(mongoPass, 10);
  }

  const match = await bcrypt.compare(password, cachedAdminHash);
  if (!match) return null;

  const adminConfig = {
    mongodb: {
      connectionString: `mongodb://${mongoUser}:${mongoPass}@localhost:27017/?authSource=admin`,
      connectionName: mongoUser,
      admin: true,
      connectionOptions: {},
    },
  };

  const adminMongo = await dbConnect(adminConfig);
  global.mongoCache['admin'] = adminMongo;

  return {
    _id: 'admin',
    username: mongoUser,
    isAdmin: true,
  };
}

async function tryLoginUser(username, password) {
  const db = mongoClient.db('temp_dbs');
  const user = await db.collection('appUsers').findOne({ username });
  if (!user) return null;

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return null;

  const newUserConfig = {
    mongodb: {
      connectionString: `mongodb://${username}:${password}@localhost:27017/${user.dbName}?authSource=${user.dbName}`,
      connectionName: user.username,
      admin: false,
      connectionOptions: {},
    },
  };

  const userMongo = await dbConnect(newUserConfig);
  global.mongoCache[user._id.toString()] = userMongo;

  return user;
}

passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

passport.deserializeUser(async (id, done) => {
  try {
    if (!mongoClient) {
        return done(new Error('MongoDB client not initialized'));
    }
    if (id === 'admin') {
      const mongoUser = process.env.MONGO_INITDB_ROOT_USERNAME || 'mongo';
      return done(null, {
        _id: 'admin',
        username: mongoUser,
        isAdmin: true,
      });
    }
    const db = mongoClient.db('temp_dbs');
    const user = await db.collection('appUsers').findOne({ _id: new mongodb.ObjectId(id) });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

export function authMiddleware(config) {
  return (req, res, next) => {
    if (!req.isAuthenticated() && req.path !== '/login') {
      return res.redirect('/login');
    }
    next();
  };
}

export function loginGetHandler(req, res) {
  res.render('login', {
    csrfToken: req.csrfToken(),
    username: req.query.username || '',
    password: req.query.password || '',
    errorMessage: req.query.error || req.session.error || null,
  });
}

export function logoutGetHandler(req,res){
  if (req.user && global.mongoCache && global.mongoCache[req.user._id.toString()]) {
    const userMongo = global.mongoCache[req.user._id.toString()];
    userMongo.clients.forEach(client => client.client.close());
    delete global.mongoCache[req.user._id.toString()];
  }
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return next(err);
    }
    res.redirect('/login');
  });
}

export function loginPostHandler(config) {
  return async (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);

      if (!user) {
        // сохраняем ошибку и значения
        return res.render('login', {
          csrfToken: req.csrfToken(),
          errorMessage: 'Пользователь не обнаружен в системе',
          username: req.body.username,
          password: req.body.password,
        });
      }

      req.logIn(user, (err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    })(req, res, next);
  };
}

export function handleQueryAuth(req, res, next) {
  const { username, password } = req.query;
  if (username && password && !req.isAuthenticated() && req.path === '/') {
    return passport.authenticate('local', {
      successRedirect: '/',
      failureRedirect: '/login?error=Invalid credentials',
      failureFlash: false,
    })(req, res, () => {
      if (req.isAuthenticated()) {
        res.redirect('/');
      } else {
        res.redirect('/login?error=Invalid credentials');
      }
    });
  }
  next();
}
