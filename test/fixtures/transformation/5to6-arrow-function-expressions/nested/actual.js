module.exports = {
  init: () => {
    return new Promise((resolve, reject) => {
      MongoClient.connect(config.mongodb, function (err, db) {
        if (err) {
          return reject(err);
        }
        this.db = db;
        resolve(this);
      });
    });
  }
};

