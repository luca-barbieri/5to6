module.exports = {
  init: function () {
    return new Promise(function(resolve, reject) {
      MongoClient.connect(config.mongodb, function(err, db) {
        if (err) {
          return reject(err);
        }
        this.db = db;
        resolve(this);
      });
    });
  }
};
