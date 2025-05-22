FROM mongo:7.0

# Установка зависимостей
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    supervisor \
    xz-utils \
    && apt-get clean

# Установка Node.js
ENV NODE_VERSION=18.18.0

RUN curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 \
  && ln -s /usr/local/bin/node /usr/bin/node \
  && ln -s /usr/local/bin/npm /usr/bin/npm \
  && ln -s /usr/local/bin/npx /usr/bin/npx \
  && node -v \
  && npm -v

# Создание логов
RUN mkdir -p /var/log/mongod /var/log/node && chmod -R 777 /var/log

# Копируем сервер
COPY ./mongo-express /app
WORKDIR /app
RUN npm install

# Копируем только конфиги supervisord и скрипты
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Открываем порты
EXPOSE 27017 8081

# Запуск через supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

