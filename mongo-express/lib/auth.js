import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import mongodb from 'mongodb';
import dbConnect from './db.js';
import { mongoClient } from './initAdminClient.js';

// Глобальный кеш для хранения подключений пользователей
global.mongoCache = global.mongoCache || {};

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      if (!mongoClient) {
        return done(new Error('MongoDB client not initialized'));
      }
      const db = mongoClient.db('temp_dbs');
      const user = await db.collection('appUsers').findOne({ username });
      if (!user) {
        return done(null, false, { message: 'Неверные данные' });
      }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return done(null, false, { message: 'Неверные данные' });
      }
      // Формируем персональный конфиг
      const newUserConfig = {
        mongodb: {
          connectionString: `mongodb://${username}:${password}@localhost:27017/${user.dbName}?authSource=${user.dbName}`,
          connectionName: user.username,
          admin: false,
          connectionOptions: {},
        },
      };

      // Создаём и сохраняем подключение
      const userMongo = await dbConnect(newUserConfig);
      global.mongoCache[user._id.toString()] = userMongo;
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

passport.deserializeUser(async (id, done) => {
  try {
    if (!mongoClient) {
      return done(new Error('MongoDB client not initialized'));
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
  return passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: false,
    failureMessage: true,
  });
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
