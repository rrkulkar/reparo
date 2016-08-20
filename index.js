'use strict';

//////////////////////////////
// Requires
//////////////////////////////
const Promise = require('bluebird');
const express = require('express');
const config = require('config');
const nunjucks = require('nunjucks');
const path = require('path');
const session = require('express-session');
const _ = require('lodash');
const multiplarty = require('connect-multiparty');

const oauth = require('./lib/oauth')();
const repos = require('./lib/github/repos');
const utils = require('./lib/github/utils');
const defaults = require('./lib/labels/default');
const text = require('./lib/labels/text');
const split = require('./lib/split');
const gen = require('./lib/labels/generate');
const pr = require('./lib/labels/pr');

//////////////////////////////
// App Variables
//////////////////////////////
const app = express();
const multipart = multiplarty();

//////////////////////////////
// Configuration
//////////////////////////////
app.set('views', path.join(__dirname, 'views'));
nunjucks.configure(['views', 'templates', 'public/images'], {
  autoescape: true,
  express: app,
});
app.set('view engine', 'html');

// Session
if (config.cookies.secure) {
  app.set('trust proxy', 1);
}
app.use(session({
  secret: config.cookies.secret,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: config.cookies.secure,
  },
}));

app.use(express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
  let auth = false;
  let host = `${config.github.api.protocol}://`;

  if (req.session.token) {
    auth = true;
  }

  // Host
  if (config.github.api.host === 'api.github.com') {
    host += 'github.com';
  }
  else {
    host += config.github.api.host;
  }

  _.set(req, 'session.authenticated', auth);
  _.set(req, 'app.locals.messages', req.session.messages);
  _.set(req, 'app.locals.user', req.session.user);
  _.set(req, 'app.locals.authenticated', auth);
  _.set(req, 'app.locals.host', host);

  _.unset(req, 'app.locals.messages');

  next();
});

//////////////////////////////
// Routing
//////////////////////////////
app.get('/', (req, res) => {
  if (req.session.authenticated) {
    res.render('repos.html', {
      repos: req.session.repos,
      labels: text(defaults),
    });
  }
  else {
    res.render('index.html', {
      token: req.session.token,
    });
  }
});

app.get('/repos', (req, res) => {
  res.render('repos.html', {
    repos: req.session.repos,
  });
});

app.post('/labels', multipart, (req, res) => {
  let labels;
  let reps;

  split(req.body).then(all => {
    labels = all.labels;
    reps = all.repos;

    return Promise.map(reps, repo => {
      return gen(labels, repo.user, repo.repo, req.session.token);
    });
  }).then(() => {
    return Promise.map(reps, repo => {
      return pr(labels, repo.user, repo.repo, req.session.token);
    });
  }).then(() => {
    res.redirect(req.get('Referrer'));
  }).catch(e => {
    console.error(e.message);
    res.redirect(req.get('Referrer'));
  });
});

// OAuth
app.get('/login', (req, res) => {
  return oauth.login(req, res);
});

app.get('/callback', (req, res) => {
  return oauth.callback(req, res);
});

oauth.on('error', (err, token, res, tokenRes, req) => {
  _.set(req, 'session.user.messages.error', err);
  res.redirect('/');
});

oauth.on('token', (token, res, tokenRes, req) => {
  return utils.user(token.access_token).then(user => {
    _.set(req, 'session.user', {
      name: user.login,
      avatar: user.avatar_url,
    });

    return repos(token.access_token);
  }).then(allRepos => {
    _.set(req, 'session.repos', allRepos);
    _.set(req, 'session.token', token.access_token);

    res.redirect('/');
  }).catch(e => {
    console.error(e);
  });
});

//////////////////////////////
// Start the server
//
// Ignored from code coverage as it's not possible to actually write a test for
// Starts the actual when this file is called directly
//////////////////////////////
/* istanbul ignore if  */
if (!module.parent) {
  app.listen(config.server.port, () => {
    console.log(`Server starting on ${config.server.host}:${config.server.port}`);
  });
}

module.exports = app;
