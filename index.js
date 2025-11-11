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
    const importsCollection = db.collection('imports');
    
    await productsCollection.createIndex({ name: "text" });


    //  USERS API 
    app.post('/users', async (req, res) => {
  const { name, email, photoURL, role } = req.body;
  if (!email) return res.status(400).send({ message: 'Email required' });

  const existingUser = await usersCollection.findOne({ email });
  if (existingUser) return res.status(409).send({ message: 'User already exists' });

    const newUser = {
    name,
    email,
    photoURL: photoURL || '',
    role: role || 'importer', // default role
    createdAt: new Date()
  };

  const result = await usersCollection.insertOne(newUser);
  res.status(201).send({ message: 'User created', insertedId: result.insertedId });
});

app.get('/users/:email', async (req, res) => {
  const email = req.params.email;
  if (!email) return res.status(400).send({ message: 'Email is required' });

  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(404).send({ message: 'User not found' });

  res.send(user);
});

app.patch('/users/:email', async (req, res) => {
  const email = req.params.email;
  const { name, photoURL, role } = req.body;

  const updateFields = {};
  if (name) updateFields.name = name;
  if (photoURL) updateFields.photoURL = photoURL;
  if (role) updateFields.role = role;

  const result = await usersCollection.updateOne(
    { email },
    { $set: updateFields }
  );

  if (result.matchedCount === 0) return res.status(404).send({ message: 'User not found' });

  res.send({ message: 'User updated', modifiedCount: result.modifiedCount });
});
//product apis
/* ===============================
   🛍️ PRODUCTS APIs
================================*/

// 1️⃣ Get all products (with optional search by name)
app.get('/products', async (req, res) => {
  const search = (req.query.search || '').trim();
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit) || 12, 1);
  const skip = (page - 1) * limit;

  const query = search ? { name: { $regex: search, $options: 'i' } } : {};

  const products = await productsCollection.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  const total = await productsCollection.countDocuments(query);

  res.send({ data: products, total, page, limit });
});

// 2️⃣ Get latest 6 products
app.get('/latest-products', async (req, res) => {
  const latest = await productsCollection.find()
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();
  res.send(latest);
});

// 3️⃣ Get a single product by ID
app.get('/products/:id', async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid product ID' });

  const product = await productsCollection.findOne({ _id: new ObjectId(id) });
  if (!product) return res.status(404).send({ message: 'Product not found' });

  res.send(product);
});

// 4️⃣ Add new product (exporter only)
app.post('/products', verifyFirebaseToken, verifyRole('exporter', usersCollection), async (req, res) => {
  const { name, price, originCountry, rating, availableQuantity, image } = req.body;

  if (!name || !price || !availableQuantity) {
    return res.status(400).send({ message: 'Name, price, and available quantity are required' });
  }

  const newProduct = {
    name,
    price,
    originCountry: originCountry || '',
    rating: rating || 0,
    availableQuantity,
    image: image || '',
    addedBy: req.token_email,
    createdAt: new Date()
  };

  const result = await productsCollection.insertOne(newProduct);
  res.status(201).send({ message: 'Product added', insertedId: result.insertedId });
});

// 5️⃣ Update product (exporter only, can only update own product)
app.patch('/products/:id', verifyFirebaseToken, verifyRole('exporter', usersCollection), async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid product ID' });

  const updateFields = req.body;
  const result = await productsCollection.updateOne(
    { _id: new ObjectId(id), addedBy: req.token_email },
    { $set: updateFields }
  );

  if (result.matchedCount === 0) return res.status(403).send({ message: 'Not allowed or product not found' });
  res.send({ message: 'Product updated', modifiedCount: result.modifiedCount });
});

// 6️⃣ Delete product (exporter only, can only delete own product)
app.delete('/products/:id', verifyFirebaseToken, verifyRole('exporter', usersCollection), async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid product ID' });

  const result = await productsCollection.deleteOne({ _id: new ObjectId(id), addedBy: req.token_email });
  if (result.deletedCount === 0) return res.status(403).send({ message: 'Not allowed or product not found' });

  res.send({ message: 'Product deleted', deletedCount: result.deletedCount });
});



/* ===============================
   📥 IMPORTS APIs (importer only)
================================*/

// 1️⃣ Import a product (reduce stock)
app.post('/imports', verifyFirebaseToken, verifyRole('importer', usersCollection), async (req, res) => {
  const { productId, quantity } = req.body;

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).send({ message: 'Product ID and valid quantity required' });
  }

  const prodObjectId = new ObjectId(productId);

  // Atomically check stock and reduce quantity
  const product = await productsCollection.findOneAndUpdate(
    { _id: prodObjectId, availableQuantity: { $gte: quantity } },
    { $inc: { availableQuantity: -quantity } },
    { returnDocument: 'after' }
  );

  if (!product.value) {
    return res.status(400).send({ message: 'Quantity exceeds available stock' });
  }

  // Save import record
  const importRecord = {
    productId: prodObjectId,
    importedBy: req.token_email,
    quantity,
    createdAt: new Date()
  };

  const result = await importsCollection.insertOne(importRecord);

  res.status(201).send({
    message: 'Product imported successfully',
    importId: result.insertedId,
    remainingStock: product.value.availableQuantity
  });
});

// 2️⃣ Get all imports of the logged-in user
app.get('/my-imports', verifyFirebaseToken, verifyRole('importer', usersCollection), async (req, res) => {
  const imports = await importsCollection.aggregate([
    { $match: { importedBy: req.token_email } },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' }
  ]).toArray();

  res.send(imports);
});

// 3️⃣ Delete an import (restore stock)
app.delete('/my-imports/:id', verifyFirebaseToken, verifyRole('importer', usersCollection), async (req, res) => {
  const importId = req.params.id;
  if (!ObjectId.isValid(importId)) return res.status(400).send({ message: 'Invalid import ID' });

  // Find and delete the import
  const deleted = await importsCollection.findOneAndDelete({
    _id: new ObjectId(importId),
    importedBy: req.token_email
  });

  if (!deleted.value) return res.status(404).send({ message: 'Import record not found' });

  // Restore product stock
  await productsCollection.updateOne(
    { _id: deleted.value.productId },
    { $inc: { availableQuantity: deleted.value.quantity } }
  );

  res.send({ message: 'Import deleted and stock restored', importId });
});
gi




//find user

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
