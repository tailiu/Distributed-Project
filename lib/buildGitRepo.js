var childProcess = require('child-proc');

function buildGitRepo(command){
  this.command = command;
}

buildGitRepo.prototype.build = function(){
  var ls = childProcess.execFile(this.command, function (error, stdout, stderr) {
     if (error) {
       console.log(error.stack);
       console.log('Error code: '+stderr);
     } 
     console.log(stdout);
  });
}

module.exports = buildGitRepo;


