const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB ERROR:${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const getFollowingPeopleIds = async (username) => {
  const getFollowingPeopleQuery = `
    SELECT following_user_id FROM follower 
    INNER JOIN user ON user.user_id=follower.follower_user_id
    WHERE user.username='${username}';`;

  const followingPeople = await db.all(getFollowingPeopleQuery);
  const listOfIds = followingPeople.map((each) => each.following_user_id);
  return listOfIds;
};

const authentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken) {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT * FROM follower where 
  follower_user_id=(select user_id from user where username='${username}')
  and following_user_id=(select user.user_id from tweet natural join user where tweet_id=${tweetId});`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//api-1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username='${username}'`;
  const userDbDetails = await db.get(getUserQuery);

  if (userDbDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user(username,password,name,gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}')`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

//api-2//

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username='${username}';`;
  const userDbDetails = await db.get(getUserQuery);
  if (userDbDetails !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDbDetails.password
    );

    if (isPasswordCorrect) {
      const payload = { username, userId: userDbDetails.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//api-3

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIds(username);

  const getTweetsQuery = `SELECT user.username,tweet.tweet,tweet.date_time as dateTime FROM user INNER JOIN tweet ON 
    user.user_id=tweet.user_id WHERE user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;`;

  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//api-4

app.get("/user/following/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUsersQuery = `SELECT name from follower INNER JOIN user ON user.user_id=follower.following_user_id
    WHERE follower_user_id='${userId}'`;

  const followingPeople = await db.all(getFollowingUsersQuery);
  response.send(followingPeople);
});

//api-5

app.get("/user/followers/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowersQuery = `
    SELECT DISTINCT name from follower INNER JOIN user ON user.user_id=follower.follower_user_id WHERE 
    following_user_id='${userId}'`;

  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

//api-6

app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    // const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT tweet.tweet, (SELECT COUNT(like_id) FROM like WHERE tweet_id='${tweetId}') AS likes,
    (SELECT COUNT(reply_id) FROM reply WHERE tweet_id='${tweetId}') AS replies,
    tweet.date_time AS dateTime FROM tweet WHERE tweet.tweet_id='${tweetId}' ;`;

    const getTweet = await db.get(getTweetQuery);
    response.send(getTweet);
  }
);

//api-7

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
    SELECT user.username FROM user INNER JOIN like ON user.user_id=like.user_id WHERE tweet_id='${tweetId}';`;

    const likedUsers = await db.all(getLikesQuery);
    const usersList = likedUsers.map((each) => each.username);
    response.send({ likes: usersList });
  }
);

//api-8

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `
    SELECT user.name,reply.reply FROM reply natural join user 
    WHERE tweet_id='${tweetId}'`;

    // const tweetQuery = `
    // SELECT tweet from tweet where tweet_id='${tweetId}'`;
    // const tweet = db.get(tweetQuery);

    const repliedUsers = await db.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);

//api-9

app.get("/user/tweets/", authentication, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `
    SELECT tweet,COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time as dateTime 
    FROM tweet LEFT JOIN reply on tweet.tweet_id=reply.tweet_id 
    LEFT JOIN like on tweet.tweet_id=like.tweet_id
    WHERE tweet.user_id='${userId}'
    GROUP BY tweet.tweet_id;`;

  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//api-10

app.post("/user/tweets/", authentication, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `
    INSERT INTO tweet(tweet,user_id,date_time)
    VALUES 
    ('${tweet}','${userId}','${dateTime}')`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//api-11

app.delete("/tweets/:tweetId", authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTheTweetQuery = `
    SELECT * FROM tweet WHERE user_id='${userId}' AND tweet_id='${tweetId}'`;

  const tweet = await db.get(getTheTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `
        DELETE from tweet where tweet_id='${tweetId}'`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
