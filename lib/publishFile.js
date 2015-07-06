var WebTorrent = require('webtorrent')
var kademlia = require('kad');
var levelup = require('level');
var querystring = require('querystring');

function publishFile(){

}

publishFile.prototype.publish = function(dhtInfor, path){
  var dht = kademlia(dhtInfor);
  var client = new WebTorrent({ dht: false, tracker: false });
  dht.on('connect', function() {  
    client.seed(path , function (torrent) {
      var meta = {infoHash:torrent.infoHash, port:client.torrentPort};
      dht.put(paths[paths.length-1], querystring.stringify(meta), function(err){});
      console.log('>Publish file successfully');
      process.send('>torrent.infoHash:'+torrent.infoHash + '\n>port:'+ client.torrentPort);
    })
  })
}

