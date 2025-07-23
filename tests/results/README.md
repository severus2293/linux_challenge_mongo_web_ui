# Нагрузочное тестирование

## Запуск
1) Запустить контейнер веб/бд с NODE_ENV=test
2) python3 init_temp_users.py
3) docker build -t mongo-locust .
4) docker run --network host mongo-locust
## Результаты нагрузочного тестирования
### Предусловия
1) Каждый пользователь имеет свою базу с 5-ю коллекциями
2) В каждой коллекции проинициализированы 100 документов
3) Всего 250 пользователей
4) Контейнер с веб/бд задействует максимум 2 логических ядра процессора
5) Тестирование проводилось 30 минут
### Описание выполняемых тестов
1) /login - авторизация пользователя
2) Aggregate heavy - Запрос списка документов в базе (агрегация с сортировкой и группировкой)
3) Regex query - Запрос списка документов в базе (поиск по регулярному выражению)
4) Update document - Обновление документа
5) Delete document - Удаление документа
6) View collections - Просмотр списка коллекций
7) Create collection - Создание коллекции
8) Delete collection - Удаление коллекции
## Результаты тестирования
1. Усредненные данные из отчета:
<img width="308" height="158" alt="Screenshot from 2025-07-23 22-46-37" src="https://github.com/user-attachments/assets/fd8dcaf7-dbc3-4720-a831-2ec8f4438eef" />

2. Percentile 99:
   <img width="991" height="541" alt="Screenshot from 2025-07-23 22-47-22" src="https://github.com/user-attachments/assets/7f58a2e7-85c2-42c0-b46d-83d3fe3f58a0" />

3. CPU (2 ядра, 27 гб RAM максимум) метрики:
   
   <img width="311" height="86" alt="Screenshot from 2025-07-23 22-46-52" src="https://github.com/user-attachments/assets/4604f053-a98f-451a-b4be-52be5a7a8d74" />

5. График CPU:
   
   <img width="991" height="357" alt="Screenshot from 2025-07-23 22-47-48" src="https://github.com/user-attachments/assets/b5bf45bc-058c-4000-9860-8254933aa283" />

7. Отчет locust приложен в этой же папке (mongo_locust_report.html)
