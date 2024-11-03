const express = require('express');
const passport = require('passport');
const session = require('express-session');
const axios = require('axios');
const { google } = require("googleapis");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const FacebookStrategy = require('passport-facebook').Strategy;
const { TwitterApi } = require('twitter-api-v2');
const { IgApiClient } = require('instagram-private-api');
const { get } = require('request-promise');
require('dotenv').config();

const app = express();

// Configuración de multer para subir videos
const upload = multer({ dest: "uploads/" });
const videoFilePath = "media/kny.mp4"

// Configuración de Twitter API
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Cargar credenciales de Google
const credentials = JSON.parse(fs.readFileSync("credentials.json"));
const { client_id, client_secret, redirect_uris } = credentials.web;

// Crear un cliente OAuth2 de Google
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Middlewares y configuración de sesión
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'mySecret',
  resave: false,
  saveUninitialized: true,
}));
app.use(passport.initialize());
app.use(passport.session());

// Configuración de Facebook Strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: "http://localhost:3000/auth/facebook/callback",
  profileFields: ['id', 'displayName', 'photos', 'email'],
}, function(accessToken, refreshToken, profile, done) {
  profile.accessToken = accessToken;
  return done(null, profile);
}));

// Serialización y deserialización de usuarios para la sesión
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Ruta principal
app.get('/', (req, res) => {
  res.send(`
    <h1>Home Page</h1>
    <p><a href="/auth/facebook">Login with Facebook</a></p>
    <p><a href="/post">Create a Post on Facebook and Twitter</a></p>
    <p><a href="/auth/youtube">Authenticate with YouTube</a></p>
    <p><a href="/upload">Upload a Video to YouTube</a></p>
  `);
});

// Autenticación con Facebook
app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'] }));

app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/profile');
  }
);

// Ruta de perfil
app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.send(`<h1>Hello, ${req.user.displayName}</h1>
    <p><a href="/post">Create a Post on Facebook and Twitter</a></p>
    <p><a href="/logout">Logout</a></p>`);
});

// Formulario para crear un post
app.get('/post', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.send(`
    <h1>Create a Post on Facebook and Twitter</h1>
    <form action="/post" method="post">
      <textarea name="content" rows="4" cols="50" placeholder="What's on your mind?"></textarea><br>
      <input type="submit" value="Post to Facebook and Twitter">
    </form>
  `);
});

// Maneja el post y publica en Facebook y Twitter
app.post('/post', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const postContent = req.body.content;

  try {
    // Publicar en Facebook
    const pagesResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
      params: {
        access_token: req.user.accessToken
      }
    });

    const pages = pagesResponse.data.data;

    if (!pages || pages.length === 0) {
      return res.send('You do not have any Facebook pages to post to.');
    }

    const pageId = pages[0].id;
    const pageAccessToken = pages[0].access_token;

    const facebookResponse = await axios.post(`https://graph.facebook.com/${pageId}/feed`, {
      message: postContent,
      access_token: pageAccessToken
    });

    console.log('Posted to Facebook page:', facebookResponse.data);

    // Publicar en Twitter
    const twitterResponse = await twitterClient.v2.tweet(postContent);
    console.log('Posted to Twitter:', twitterResponse);

    res.send('Successfully posted on Facebook and Twitter');

  } catch (error) {
    console.error('Error posting to social media:', error);
    res.send('Failed to post on social media.');
  }
});

// Autenticación para YouTube
app.get("/auth/youtube", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
  });
  res.redirect(authUrl);
});

// Callback de autenticación de Google para YouTube
app.get("/auth/youtube/callback", async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  res.send("YouTube authentication successful. You can now upload videos.");
});

// Formulario de subida de video a YouTube
app.get('/upload', (req, res) => {
  res.send(`
    <h1>Upload a Video to YouTube</h1>
    <form action="/upload/youtube" method="post" enctype="multipart/form-data">
      <input type="file" name="video" accept="video/*"><br>
      <input type="submit" value="Upload to YouTube">
    </form>
  `);
});

// Subida de video a YouTube
app.post("/upload/youtube", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).send("No video uploaded");

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  try {
    //const videoPath = path.join(__dirname, req.file.path);
    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: {
          title: "test kny",
          description: "Video Description",
          categoryId: 24,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: "private",
        },
      },
      media: {
        body: fs.createReadStream(videoFilePath),
      },
    });

    // Eliminar archivo temporal
    fs.unlinkSync(videoFilePath);

    res.send(`Video successfully uploaded: https://youtu.be/${response.data.id}`);
  } catch (error) {
    console.error("Error uploading video:", error);
    res.status(500).send("Failed to upload video.");
  }
});

// Cerrar sesión
app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
