import express from 'express';
let app = express();
app.set('view engine', 'ejs');
app.use(express.static('build'));
import Promise from 'bluebird';

import whoami from 'controllers/whoami';
import * as links from 'controllers/links';
import {checkRepo} from 'controllers/checkRepo';
import webhook from 'controllers/webhook';
import webhookOld from 'controllers/webhookOld';

import isLinkPaid from 'helpers/isLinkPaid';
import {addWebhooksForLink, removeOldWebhooksForLink} from 'helpers/addWebhooksForLink';

// ----------------------------------------------------------------------------
// Database stuff
// ----------------------------------------------------------------------------
import {Schema} from 'jugglingdb';
import userBuilder from 'models/User';
import linkBuilder from 'models/Link';
import repositoryBuilder from 'models/Repository';
const schema = new Schema('memory');
const User = userBuilder(schema);
const Repository = repositoryBuilder(schema);
const Link = linkBuilder(schema);

schema.automigrate();

// ----------------------------------------------------------------------------
// Passport stuff
// ----------------------------------------------------------------------------
import passport from 'passport';
import session from 'express-session';
import strategy from 'auth/strategy';
import serialize from 'auth/serialize';
app.use(session({
  secret: process.env.SESSION_SECRET,
  // store: mongoStore,
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(strategy(User));
serialize(User, passport);

import bodyParser from 'body-parser';
import morgan from 'morgan';
app.use(morgan('tiny'));

// Authenticate a user
app.get('/setup/login', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/setup/failed',
  scope: ["repo", "write:repo_hook", "user:email"],
}));
app.get('/setup/login/public', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/setup/failed',
  scope: ["public_repo", "write:repo_hook", "user:email"],
}));

// Second leg of the auth
app.get("/auth/github/callback", passport.authenticate("github", {
  failureRedirect: '/setup/failed',
}), (req, res) => {
  res.redirect('/#/links'); // on success
});

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// A utility function to check if a user is authenticated, and if so, return
// the authenticated user. Otherwise, this function will throw an error
function assertLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.status(403).send({error: 'Not authenticated.'});
  }
}


// identify the currently logged in user
app.get('/api/v1/whoami', whoami);

// get all links
app.get('/api/v1/links', bodyParser.json(), assertLoggedIn, links.index.bind(null, Link));

// GET a given link
app.get('/api/v1/links/:id', bodyParser.json(), assertLoggedIn, links.get.bind(null, Link));

// create a new link
app.post('/api/v1/links', bodyParser.json(), assertLoggedIn, links.create.bind(null, Link));

// delete a link
app.delete('/api/v1/links/:id', links.del.bind(null, Link, User));

// return the branches for a given repo
app.get('/api/v1/repos/:provider/:user/:repo', bodyParser.json(), checkRepo);

// POST link updates
app.post('/api/v1/links/:linkId',
  bodyParser.json(),
  assertLoggedIn,
  links.update.bind(null, Link, User, addWebhooksForLink, removeOldWebhooksForLink)
);

// enable or disable a repository
app.post('/api/v1/link/:linkId/enable', bodyParser.json(), links.enable.bind(null, Link, User));

// the old webhook route
// This parses the body of the request to get most of its data.
app.post("/", bodyParser.json(), webhookOld);
app.route("/ping/github/:user/:repo").get((req, res) => {
  res.redirect(`https://github.com/${req.params.user}/${req.params.repo}`);
}).post(webhook);

// the new webhook route
// No body parsing, all oauth-based
app.all('/_:linkId', webhook.bind(null, Link));

// For letsencrypt
app.get('/.well-known/acme-challenge/:id', (req, res) =>
  res.status(200).send(process.env.LETSENCRYPT_ID)
);

let port = process.env.PORT || 8001;
app.listen(port);
console.log("Listening on port", port, "...");