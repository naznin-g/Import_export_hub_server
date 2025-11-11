// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin Setup
const serviceAccount = require("./import-export-hub-firebase-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Token Verification Middleware
const verifyFireBaseToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authorization.split(' ')[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log('Inside token',decoded)
    req.token_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

const verifyRole = (requiredRole, usersCollection) => {
  return async (req, res, next) => {
    try {
      const user = await usersCollection.findOne({ email: req.token_email });
      if (!user) return res.status(403).send({ message: 'User not found' });
      if (user.role !== requiredRole) return res.status(403).send({ message: 'Access denied' });
      req.user = user; // attach user object if needed
      next();
    } catch (err) { next(err); }
  };
};

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

// Test route
app.get('/', (req, res) => {
  res.send('Smart server is running');
});
//db_pass: ZiKatLs143mzR6zm
//db_user:importExportHub
async function run() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);

    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const importsCollection = db.collection('import');

    // ---------------- USERS API ----------------
    app.post('/users', async (req, res) => {
      const newUser = req.body;
      const email = newUser.email;
      const existingUser = await usersCollection.findOne({ email });

      if (existingUser) {
        return res.send({ message: 'User already exists.' });
      }

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // ---------------- PRODUCTS API ----------------
    app.get('/products', async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const products = await productsCollection.find(query).toArray();
      res.send(products);
    });

    app.get('/latest-products', async (req, res) => {
      const products = await productsCollection.find().sort({ created_at: -1 }).limit(6).toArray();
      res.send(products);
    });

    app.get('/products/:id', async (req, res) => {
      const id = req.params.id;
      const product = await productsCollection.findOne({ _id: new ObjectId(id) });
      res.send(product);
    });

    app.post('/products', verifyFireBaseToken, async (req, res) => {
      const newProduct = req.body;
      const result = await productsCollection.insertOne(newProduct);
      res.send(result);
    });

    app.patch('/products/:id', async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      res.send(result);
    });

    app.delete('/products/:id', async (req, res) => {
      const id = req.params.id;
      const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ---------------- BIDS API ----------------
    // Get authenticated user bids
    app.get('/bids/my', verifyFireBaseToken, async (req, res) => {
      const email = req.query.email;
      if (email && email !== req.token_email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      const query = email ? { buyer_email: email } : {};
      const bids = await bidsCollection.find(query).toArray();
      res.send(bids);
    });

    // Get all bids for a product sorted by price
    app.get('/products/bids/:productId', async (req, res) => {
      const productId = req.params.productId;
      const bids = await bidsCollection.find({ product: productId }).sort({ bid_price: -1 }).toArray();
      res.send(bids);
    });

    // Create a bid
    app.post('/bids', async (req, res) => {
      const newBid = req.body;
      const result = await bidsCollection.insertOne(newBid);
      res.send(result);
    });

    // Delete a bid
    app.delete('/bids/:id', async (req, res) => {
      const id = req.params.id;
      const result = await bidsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    console.log('✅ MongoDB connected and APIs are ready');
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
  }
}

run().catch(console.dir);

// Start the server
app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
