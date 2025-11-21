const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const app = express();
const port = process.env.PORT || 5000;

// Initialize Firebase Admin
const admin=require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB setup
const client = new MongoClient(process.env.MONGO_URI);

async function run() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const importsCollection = db.collection("imports");

    console.log("✅ MongoDB connected");

    // -------------------------------
    // Middleware: Verify Firebase Token
    // -------------------------------
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).send({ message: "Unauthorized access" });

      const token = authHeader.split(" ")[1];

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.firebaseUid = decoded.uid;
        req.userEmail = decoded.email; 
        next();
      } catch (err) {
        //console.error(err);
        res.status(401).send({ message: "Unauthorized Access" });
      }
    };

    
    // USERS API
    

    // Add/Register a new user
    app.post('/users', async (req, res) => {
      const newUser = req.body;
      const email = newUser.email;

      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.send({ message: 'User already exists. No need to insert again' });
      }

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });


    //latest 6 product
    app.get('/latest-products', async (req, res) => {
    
    const products = await productsCollection
        .find()
        .sort({ createdAt: -1 }) // newest first
        .limit(6)
        .toArray();

    
    const latestProducts = products.map(product => ({
        _id: product._id,
        image: product.image,
        name: product.name,
        price: product.price,
        originCountry: product.originCountry,
        rating: product.rating,
        availableQuantity: product.availableQuantity
    }));

    res.send(latestProducts);
});

    //All Product
    app.get('/products', async (req, res) => {
    const search = (req.query.search || "").trim(); // optional search by product name
    const query = search ? { name: { $regex: search, $options: "i" } } : {};

    const products = await productsCollection
        .find(query)
        .sort({ createdAt: -1 }) 
        .toArray();

    
    const result = products.map(product => ({
        _id: product._id,
        image: product.image,
        name: product.name,
        price: product.price,
        originCountry: product.originCountry,
        rating: product.rating,
        availableQuantity: product.availableQuantity
    }));

    res.send(result);
});

    //Add product/Export product/products added by user /Exporter
    app.post('/products', verifyFirebaseToken,async(req, res)=>{
      const product=req.body;
      product.exporterEmail=req.userEmail;
      product.created_at=new Date();
      const result=await productsCollection.insertOne(product);
      res.send(result);
    });

    app.get("/product/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await productsCollection.findOne(query);
    res.send(result);
});

    //Deleting a product by the exporter/user who added /created the product
    app.delete('/product/:id',verifyFirebaseToken, async(req, res)=>{
      const productId=req.params.id;
      const result=await productsCollection.deleteOne({_id:new ObjectId(productId)});
      exporterEmail=req.userEmail;
      res.send(result);
    });
    //Update products(by exporter and importer
    app.patch('/product/:id', verifyFirebaseToken, async (req, res) => {
  const productId = req.params.id;
  const { price, quantityChange } = req.body; 

  const updateFields={};
  if (price !== undefined) updateFields.price=price;

  if (typeof quantityChange === "number" && quantityChange !== 0) {
    updateFields.availableQuantity=quantityChange;
  }

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).send({ message: "Nothing to update" });
  }  
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(productId) },
      { $inc: { availableQuantity: quantityChange } }
    );

    res.send(result);
  
});



    //list of importers of a specific product
    app.get('/product/:id/imports', async(req, res)=>{
      const productId=req.params.id;
      const importCursor=importsCollection.find({productId:productId}).sort({importedAt:-1});
      const imports=await importCursor.toArray();
      const importers=imports.map((imp)=>({
        importerEmail:imp.importerEmail,
        importedQuantity:imp.importedQuantity,
        importedAt:imp.importedAt
      }));
      res.send(importers);
    });


app.post('/product/:id/imports', verifyFirebaseToken, async (req, res) => {
  try {
    const productId = req.params.id;
    const { quantity } = req.body;
    const importerEmail = req.userEmail;

    // Find product
    const product = await productsCollection.findOne({ _id: new ObjectId(productId) });

    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }
    if (product.exporterEmail===importerEmail){
      return res.status(400).send({ message: "Exporters cannot import their own products" });

}
    
      //return()

    if (quantity > product.availableQuantity) {
      return res.status(400).send({ message: "Not enough stock" });
    }

    // Create import record
    const newImport = {
      productId,
      importerEmail,
      importedQuantity: quantity,
      importedAt: new Date(),
    };

    await importsCollection.insertOne(newImport);

    // Update stock
    const newStock = product.availableQuantity - quantity;

    await productsCollection.updateOne(
      { _id: new ObjectId(productId) },
      { $set: { availableQuantity: newStock } }
    );

    res.send({
      message: "Imported successfully",
      remainingStock: newStock,
    });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error during import" });
  }
});




//
//
//app.post("/imports", verifyFirebaseToken, async (req, res) => {
//  const { productId, quantity } = req.body;
//  const importerEmail = req.user.email;
//  const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
//  if (quantity > product.availableQuantity) {
//    return res.status(400).send({ message: "Import quantity exceeds available quantity" });
//  }
//
//  
//  const newImport = {
//    productId,
//    importerEmail,
//    quantity,
//    date: new Date(),
//  };
//  await importsCollection.insertOne(newImport);
//
//  
//  await productsCollection.updateOne(
//    { _id: new ObjectId(productId) },
//    { $inc: { availableQuantity: -quantity } }
//  );
//
//  res.send({ message: "Product imported successfully" });
//});
//
//
//
//

    //imported product list of a specific importer
    app.get('/my-imports', verifyFirebaseToken, async (req, res) => {
  const userEmail = req.userEmail;

  const imports = await importsCollection
    .find({ importerEmail: userEmail })
    .toArray();
    console.log(imports);

  // Group imports by productId
  const grouped = {};
  for (const imp of imports) {
    if (!grouped[imp.productId]) {
      grouped[imp.productId] = { totalQuantity: 0, lastImportedAt: imp.importedAt };
    }
    grouped[imp.productId].totalQuantity += imp.importedQuantity;
    if (imp.importedAt > grouped[imp.productId].lastImportedAt) {
      grouped[imp.productId].lastImportedAt = imp.importedAt;
    }
  }

  const result = await Promise.all(
    Object.keys(grouped).map(async (productId) => {
      const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
      if (!product) return null;
      return {
        _id: product._id,
        image: product.image || "https://via.placeholder.com/150",
        name: product.name,
        price: product.price,
        rating: product.rating,
        originCountry: product.originCountry,
        totalImportedQuantity: grouped[productId].totalQuantity,
        lastImportedAt: grouped[productId].lastImportedAt,
      };
    })
  );

  res.send(result.filter(p => p !== null));
});


//remove a imported product from a users import list
app.delete('/my-imports/:id', async (req, res) => {
  const id = req.params.id;
  const userEmail=req.userEmail
  const query = { productId:id,
    impoterEmail:userEmail
   };
  const result = await importsCollection.deleteMany(query);

  res.send({ deleted: result.deletedCount > 0 });
});


app.get('/my-exports', verifyFirebaseToken, async (req, res) => {
  const exporterEmail = req.userEmail; // comes from verifyFirebaseToken
  const myProducts = await productsCollection
    .find({ exporterEmail })
    .sort({ created_at: -1 })
    .toArray();

  res.send(myProducts);
});
    




     console.log("Pinged your deployment. You successfully connected to MongoDB!");




    }
    finally {

    }
}

run().catch(console.dir)

app.listen(port, () => {
    console.log(`Smart server is running on port: ${port}`)
})














