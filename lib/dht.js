var kademlia = require('kad');
var levelup = require('level');

function dht (ipAddr, portNum, seedsNode, db){
  this.dhtVar = kademlia({
    address: ipAddr,
    port: portNum,
    seeds: seedsNode,
    storage: levelup(db)
  });
}

dht.prototype.setUp = function (key, value){
  this.dhtVar.on('connect', function() {
   this.dhtVar.put(key, value, function(err) {
      console.log('done');
   });
  })
}

dht.prototype.getVal = function (file){
  this.dhtVar.on('connect', function() {
   this.dhtVar.get(file, function(err, value) {
      console.log(value);
      return value;
   });
  })
}

module.exports = dht;

