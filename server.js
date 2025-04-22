import express from "express";
import axios from "axios";
import mysql from "mysql2/promise";
import 'dotenv/config';
import oidc from 'express-openid-connect';
import cors from 'cors';
import { send } from "vite";

const app = express();

const {auth, requiresAuth} = oidc;

const config = {
  authRequired: process.env.AUTHREQUIRED,
  auth0Logout: process.env.AUTH0LOGOUT,
  baseURL: process.env.BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  secret: process.env.SESSION_SECRET,
  session: {
    rolling: true,
    cookie: { secure: false }  // Set to `true` if using HTTPS
  }
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

//allows express to parse JSON IMPORTANT
app.use(express.json());

// Create a connection to the database
const db = mysql.createPool({
  host: "localhost",
  user: "root",      
  password: `${process.env.DB_PASSWORD}`, 
  database: "mtsfitness",   
  waitForConnections: true,
  port: 3307 
});

app.use(cors({
  origin: [
    `http://${process.env.VITE_FRONTEND_HOST}`
  ],
  credentials: true,
  exposedHeaders: ['set-cookie']
}));

const getUserInfo = async (email) => {
  const user_id_query = 'SELECT id FROM users WHERE email = ?'

  const [id] = await db.query(user_id_query, [email]);

  const query = 'SELECT * FROM user_details WHERE user_id = ?'
  const [response] = await db.query(query, [id[0].id])

  return response;

}

const suggestion = async (exercises, exerciseLimit) => {

  const result = [];

  for(const muscle of exercises){
    const options = {
      method: 'GET',
      url: `https://${process.env.API_HOST}/exercises/target/${muscle.toLowerCase()}`,
      params: {
        limit: exerciseLimit,
        offset: '0'
      },
      headers: {
        'x-rapidapi-key': process.env.API_KEY,
        'x-rapidapi-host': process.env.API_HOST
      }
    };

    try {
      const response = await axios.request(options);
      result.push(response.data);
    } catch (error) {
      console.error(error);
    }
  }

  return result;

}

//retrieves the name of the user
app.get('/getName',(req,res) => {
  if (!req.oidc.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  res.json({ name: req.oidc.user.given_name }); // Send JSON response
});

app.get('/',  async (req, res) => {

  if(req.oidc.isAuthenticated()){
    try{
      const first_name = req.oidc.user.given_name;
      const last_name = req.oidc.user.family_name;
      const email = req.oidc.user.email;
      const day = new Date().getDate()
      const year = new Date().getFullYear()
      const month = new Date().getMonth()
      const date = year.toString() + "-" + month.toString() + "-" + day.toString()
    
      const q = 'SELECT COUNT(*) AS count FROM users WHERE email = ?'
    
      const [rows] = await db.query(q,email);
      const email_exists = rows[0].count > 0;
    
      if (!email_exists){
        const sql = 'INSERT INTO users (first_name, last_name, email, created_at) VALUES ( ?, ?, ?, ?)';
        const [result] = await db.query(sql, [first_name, last_name, email,date]);
          
        return res.redirect(`http://${process.env.VITE_FRONTEND_HOST}/questionaire`);
        //create account and go to questionaire to add extra details
      }

      //account is already created with extra information added, send user to dashboard
      
      return res.redirect(`http://${process.env.VITE_FRONTEND_HOST}/dashboard`);
    }
    catch(error){
      console.error("Database Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }

  return res.redirect(`http://${process.env.VITE_FRONTEND_HOST}`);

});

// The /profile route will show the user profile as JSON
app.get('/profile', requiresAuth(), (req, res) => {
  res.send(JSON.stringify(req.oidc.user, null, 2));
});

app.get('/suggestion',requiresAuth(), async (req,res) => {

  const mSuggestion =  [['cardiovascular system'],['Upper Back','Biceps'],['Glutes','Hamstrings'],
  ['Pectorals','Triceps','Abs'],['Delts','cardiovascular system'],['Upper Back', 'Biceps','Forearm'],['cardiovascular system']]

  const fSuggestion =  [['cardiovascular system'],['Glutes','Hamstrings','Quads'],['Upper Back','Biceps'],
  ['Abs','Triceps','Pectorals'],['Glutes','Quads','Hamstrings'],['Upper Back', 'Biceps'],['cardiovascular system']]


  let suggestedExercises = ''

  try{
    const data = await getUserInfo(req.oidc.user.email)

    const date = new Date().getDay();
    
    if(data[0].gender == "male"){

      suggestedExercises = await suggestion(mSuggestion[date],'3');

    }
    else{

      suggestedExercises = await suggestion(fSuggestion[date],'3');

    }
    
    return res.json(suggestedExercises);

  }
  catch (error) {
    console.error("Database Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }

})

app.get('/logout', (req, res) => {
  const returnTo = encodeURIComponent(`http://${process.env.VITE_FRONTEND_HOST}/logout-success`); 
  res.redirect(`https://${process.env.AUTH0_ISSUER_BASE_URL}/v2/logout?client_id=${process.env.AUTH0_CLIENT_ID}&returnTo=${returnTo}`);
});

// Example route to fetch data from the users table
app.get("/users", (req, res) => {
    const query = "SELECT * FROM users";
    db.query(query, (err, results) => {
      if (err) {
        console.error("Error fetching data:", err.message);
        res.status(500).send("Error fetching data");
        return;
      }
      res.json(results);
    });
  });

app.get("/getUser", requiresAuth(), async (req,res) => {

    const query = 'SELECT id FROM users WHERE email = ?'

    const [result] = await db.query(query, [req.oidc.user.email]);
    
    res.send(result)
});

app.post("/addUserInfo",requiresAuth(), async (req,res) => {
  try {

    const id_query = 'SELECT id FROM users WHERE email = ?'

    const [id] = await db.query(id_query, [req.oidc.user.email]);    

    const query = 'INSERT INTO user_details (user_id,height,weight,gender,goal,age,focus) VALUES (?, ? ,? , ?, ?, ?, ?)'
    const [response] = await db.query(query, [id[0].id,req.body.height, req.body.weight, req.body.gender, req.body.goal,req.body.age, req.body.focus]);

    res.sendStatus(200);
  } catch (error) {
    console.error("Database Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/getUserInfo", async (req,res) => {

  try{

    const response = await getUserInfo(req.oidc.user.email)

    res.json(response[0])
    
  }
  catch (error){
    console.error("Database Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

//Retrieve exercise list for a specific muscle group
app.get("/api/exercises/muscles/:muscle", async (req,res) => {
const { muscle } = req.params;


const options = {
  method: 'GET',
  url: `https://${process.env.API_HOST}/exercises/target/${muscle}`,
  params: {
    limit: '10',
    offset: '0'
  },
  headers: {
    'x-rapidapi-key': process.env.API_KEY,
    'x-rapidapi-host': process.env.API_HOST
  }
};

try {
	const response = await axios.request(options);
  res.send(response.data)
} catch (error) {
	console.error(error);
}
});

// Start the server
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
