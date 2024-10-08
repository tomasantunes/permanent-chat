var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var OpenAI = require('openai');
var secretConfig = require('./secret-config');
var mysql = require('mysql2');
var mysql2 = require('mysql2/promise');
var session = require('express-session');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: secretConfig.SESSION_KEY,
  resave: false,
  saveUninitialized: true
}));

const client = new OpenAI({
  apiKey: secretConfig.OPENAI_API_KEY
});

var con;
var con2;

if (secretConfig.ENVIRONMENT == "WINDOWS" || secretConfig.ENVIRONMENT == "MACOS") {
  con = mysql.createPool({
    connectionLimit : 90,
    connectTimeout: 1000000,
    host: secretConfig.DB_HOST,
    user: secretConfig.DB_USER,
    password: secretConfig.DB_PASSWORD,
    database: secretConfig.DB_NAME,
    timezone: '+00:00',
    port: 3306
  });

  con2 = mysql2.createPool({
    connectionLimit : 90,
    connectTimeout: 1000000,
    host: secretConfig.DB_HOST,
    user: secretConfig.DB_USER,
    password: secretConfig.DB_PASSWORD,
    database: secretConfig.DB_NAME,
    timezone: '+00:00',
    port: 3306
  });
}
else if (secretConfig.ENVIRONMENT == "UBUNTU") {
  con = mysql.createPool({
    connectionLimit : 90,
    connectTimeout: 1000000,
    host: secretConfig.DB_HOST,
    user: secretConfig.DB_USER,
    password: secretConfig.DB_PASSWORD,
    database: secretConfig.DB_NAME,
    socketPath: '/var/run/mysqld/mysqld.sock',
    timezone: '+00:00'
  });

  con2 = mysql2.createPool({
    connectionLimit : 90,
    connectTimeout: 1000000,
    host: secretConfig.DB_HOST,
    user: secretConfig.DB_USER,
    password: secretConfig.DB_PASSWORD,
    database: secretConfig.DB_NAME,
    socketPath: '/var/run/mysqld/mysqld.sock',
    timezone: '+00:00'
  });
}


async function getChatCompletion(messages) {
  const chatCompletion = await client.chat.completions.create({
    messages: messages,
    model: 'gpt-4o',
  });
  var reply = chatCompletion.choices[0].message.content;
  return reply;
}

app.get('/', function(req, res) {
  res.sendFile("public/login.html", {root: __dirname });
});

app.get("/home", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }
  res.sendFile("public/home.html", {root: __dirname });
});

app.post("/submit-message", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }

  var submittedMessage = req.body.message;
  var chat_id = req.body.chat_id;

  console.log("Submitted message: " + submittedMessage);

  var sql = "INSERT INTO posts (content, role, chat_id) VALUES (?, 'user', ?)";
  con.query(sql, [submittedMessage, chat_id], async function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
    }


    console.log("x1");
    // Select all the messages from the database and get a chat completion.
    var sql2 = "SELECT * FROM posts WHERE chat_id = ?";
    con.query(sql2, [chat_id], async function (err, result) {
      if (err) {
        console.log(err);
        res.json({status: "NOK", error: err.message});
      }

      console.log("x2");
      var messages = [];
      for (var i = 0; i < result.length; i++) {
        messages.push({role: result[i].role, content: result[i].content});
      }

      messages.push({role: "user", content: submittedMessage});

      console.log("x3");
      var reply = await getChatCompletion(messages);
      console.log("x4");

      var sql3 = "INSERT INTO posts (content, role, chat_id) VALUES (?, 'assistant', ?)";
      con.query(sql3, [reply, chat_id], function (err, result) {
        if (err) {
          console.log(err);
          res.json({status: "NOK", error: err.message});
        }

        console.log("x5");
        res.json({status: "OK"});
      });
    });
  });
});

app.get("/get-chats", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }

  var sql = "SELECT * FROM chats";
  con.query(sql, function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
    }

    res.json({status: "OK", data: result});
  });
});

app.post("/new-chat", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }

  var title = req.body.title;

  var sql = "INSERT INTO chats (title) VALUES (?)";
  con.query(sql, [title], function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
    }

    res.json({status: "OK", data: result.insertId});
  });
});

app.get("/get-chat", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }

  var chat_id = req.query.chat_id;

  var sql = "SELECT * FROM posts WHERE chat_id = ?";
  con.query(sql, [chat_id], function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
    }

    res.json({status: "OK", data: result});
  });
});

app.post("/delete-chat", function(req, res) {
  if (!req.session.isLoggedIn) {
    res.json({status: "NOK", error: "Invalid Authorization."});
    return;
  }

  var chat_id = req.body.chat_id;

  var sql = "DELETE FROM posts WHERE chat_id = ?";
  con.query(sql, [chat_id], function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
    }

    var sql2 = "DELETE FROM chats WHERE id = ?";
    con.query(sql2, [chat_id], function (err2, result2) {
      if (err2) {
        console.log(err2);
        res.json({status: "NOK", error: err2.message});
      }

      res.json({status: "OK"});
    });
  });
});

app.post("/api/check-login", (req, res) => {
  var user = req.body.user;
  var pass = req.body.pass;

  var sql = "SELECT * FROM logins WHERE is_valid = 0 AND created_at > (NOW() - INTERVAL 1 HOUR);";

  con.query(sql, function (err, result) {
    if (err) {
      console.log(err);
      res.json({status: "NOK", error: err.message});
      return;
    }
    console.log("x3");
    if (result.length <= 5) {
      if (user == secretConfig.USER && pass == secretConfig.PASS) {
        req.session.isLoggedIn = true;
        var sql2 = "INSERT INTO logins (is_valid) VALUES (1);";
        con.query(sql2, function(err2, result2) {
          if (err2) {
            console.log(err2);
            res.json({status: "NOK", error: err2.message});
            return;
          }
          res.json({status: "OK", data: "Login successful."});
        });
      }
      else {
        var sql2 = "INSERT INTO logins (is_valid) VALUES (0);";
        con.query(sql2, function(err2, result2) {
          if (err2) {
            console.log(err2);
            res.json({status: "NOK", error: err2.message});
            return;
          }
          res.json({status: "NOK", data: "Wrong username/password."});
        });
      }
    }
    else {
      res.json({status: "NOK", error: "Too many login attempts."});
    }
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
