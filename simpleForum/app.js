var express = require('express')
var querystring = require('querystring')
var bodyParser = require('body-parser')
var stencil = require('./stencil')
var deasync = require('deasync')
var app = express()
var childProcess = require('child-proc')
var os = require('os')
var mkdirp = require('mkdirp')
var crypto = require('crypto')
var http = require('http')
var https = require('https')
var fs = require('graceful-fs')
var _ = require('underscore')
var request = require('request')
var cluster = require('cluster')
var util = require('./util')

var REORDER = 0
var ORDER = 1

const userKeysDir = 'user_keys/'
const usermetaFile = 'user_meta'
const adminReposDir = 'admin_repos'
const groupMetaFile = 'group_meta'
const memListFile = 'member_list'
const uploadedFilesDir = 'uploaded_files'
const defaultSSHKeysDir = '/home/'+ findCurrentAccount() + '/.ssh'
const knownHostsPath = '/home/' + findCurrentAccount() + '/.ssh/known_hosts'
const numResponseBots = 2
const largestPortNum = 65536

const localDHTNodeAddr = 'localhost'
const localDHTNodeDBFilePart = 'db-p'
const baseLocalDHTNodePort = 1025
const DHTSeed = {
 	address: '127.0.0.1',
	port: 8200
}

const httpListeningPort = 3000

//stencil public key in pem format
const stencilPublicKey = 
'-----BEGIN PUBLIC KEY-----\n' + 
'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoczHXSbaxMWFFIfWtdTj\n' + 
'X1o7EgGVJGzQxkuz1QIqYUnfBG/VQLdjS9yeNAtqTWHYi5QihGGvADZYOxhwCtME\n' + 
'msqGRo++WrS4CJR13D+OxsupSed2nt8LvBH1dmiEC3FhrFsGbjIsjhqpzgTfgn11\n' + 
'BCSsvnuca4HIZMeHUeubj/zkl/ki0a6RTMYv41QdGEZY6VaGjaDQdPz8xL57cG+x\n' + 
'RxRag9JVsH0XXE1fi9N4C4+kcR7EQNdUJmIsYS44Bk/lbFGw4FES8sIHBONevANU\n' + 
'9zV4V89OKHjgehrZ0WVDmW6/wF0RTHYTpDGryrVusMC82vnUqWrbwOF6Hnqx1dK+\n' + 
'EQIDAQAB\n' + 
'-----END PUBLIC KEY-----'

const forumPublicKey = 
'-----BEGIN PUBLIC KEY-----\n' + 
'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxD8g4vKqHB8/lyRXZTeE\n' + 
'Yi2K0n+dLQxUsMabva/LXHBPq2KGY9GdFepq5KQ4vGJ17dk4S7DcoyAWNNLYqa1b\n' + 
'9KV2mOiCiRlg3W+7hu8rCzXKVny5I6dGMqL8++Ut/EK0y24/2eXbpHSjUs3xryPj\n' + 
'arDqswoCFtWTkw6v0nFYVkfmQLMg4VlzRBbVnVywI+4cR5Cw+Hm9l3XFscoYN31t\n' + 
'YYxcyNScNnN/qd89T419jceO2scNHCEZ38fgtFObsmYbzi34A0DFOf6KpQCvwprb\n' + 
'JYo7QB0Qh6cqqKfRpvYM39DJvFfBTOMFGqbIfY2M9tfgw+CZ8atGw+u9nUU09fsc\n' + 
'RQIDAQAB\n' + 
'-----END PUBLIC KEY-----'


app.set('views', './views/jade')
app.set('view engine', 'jade')
app.use(bodyParser.json())       	// to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
	extended: true
}))

var localDHTNode
var masterView = util.masterView
var responseBots = []
var moderatorBots = []
var syncBots = []

function getAccount() {
	var account = childProcess.execSync('whoami')
	account = (account + '').replace(/(\r\n|\n|\r)/gm,"")
	return account
}

//find current account on the machine
function findCurrentAccount() {
	var account = childProcess.execSync('whoami')
	account = (account + '').replace(/(\r\n|\n|\r)/gm,"")
	return account
}

function sortPosts(posts, sort) {
	if (sort == REORDER || sort == null) {
		posts.sort(function (a, b) {
			c = new Date(a.lastUpadateTs)
			d = new Date(b.lastUpadateTs)
			return d-c;
		})
	} else {
		posts.sort(function (a, b) {
			c = new Date(a.lastUpadateTs)
			d = new Date(b.lastUpadateTs)
			return c-d;
		})
	}
	return posts
}

function filterPosts(posts, tag) {
	var filteredPosts = []
	for (var i = 0; i < posts.length; i++) {
		if (posts[i].tags.constructor === Array) {
			var arr = posts[i].tags
			if (arr.indexOf(tag) != -1) {
				filteredPosts.push(posts[i])
			}
		} else {
			if (posts[i].tags == tag) {
				filteredPosts.push(posts[i])
			}
		}
	}
	return filteredPosts
}


function calculateHash(value) {
	var hash = crypto.createHash('sha256')
	hash.update(value)
	return hash.digest('hex')
}

function getPublicKeyLocally(keyPath) {
	var publicKey
	try {
		publicKey = fs.readFileSync(keyPath + 'public.pem', 'utf8')
	} catch (err) {
		publicKey = undefined
	}
	return publicKey
}

function getPrivateKeyLocally(keyPath) {
	return fs.readFileSync(keyPath + 'private.pem', 'utf8')
}

function createPublicKeyPair(keyPath) {
	var command = 'openssl genrsa -out ' + keyPath + 'private.pem 2048\n'
	command += 'openssl rsa -in ' + keyPath + 'private.pem -pubout > ' + keyPath + 'public.pem\n'

	childProcess.execSync(command)
}

function createCertificate(keyPath) {
	var command = 'openssl req -new -sha256 -key ' + keyPath + 'private.pem -out ' + keyPath + 'csr.pem '
	command += '-subj "/C=US/ST=NY/L=NY/O=NYU/CN=192.168.0.1"\n'
	command += 'openssl x509 -req -in ' + keyPath + 'csr.pem -signkey '  + keyPath + 'private.pem -out ' + keyPath + 'cert.pem\n'

	childProcess.execSync(command)
}

function createSSHKeyPair(keyName) {
	var command = 'ssh-keygen -f ' +  getSSHKeyName(keyName) + ' -t rsa -N \'\'\n'

	childProcess.execSync(command)
}

function createUser(username, callback) {
	mkdirp(userKeysDir)

	createPublicKeyPair(userKeysDir)
	createCertificate(userKeysDir)

	var publicKey = getPublicKeyLocally(userKeysDir)
	var hashedPublicKey = calculateHash(publicKey)
	mkdirp.sync(hashedPublicKey)

	createSSHKeyPair(hashedPublicKey)

	var keysDir = getUserKeysDir(hashedPublicKey)
	mkdirp.sync(keysDir)
	
	var command = 'mv -if ' + userKeysDir + '/* ' + keysDir + '/\nrm -r ' + userKeysDir + '\n'
	childProcess.execSync(command)

	var localUserMeta = {}
	localUserMeta.ts = new Date()
	localUserMeta.username = username

	fs.writeFile(hashedPublicKey + '/' + usermetaFile, JSON.stringify(localUserMeta), function(err) {
		callback(hashedPublicKey)
	})
}

//Initial page
app.post('/initial-page', function(req, res) {
    var username = req.body.username
    var password = req.body.password
    var op = req.body.login
    if (op == undefined) {
    	res.render('register')
    } else {
    	stencil.getUserInfo(username, function (usermeta) {
    		if (usermeta == undefined) {
    			res.end("<html> <header> " + username + " does not exist! </header> </html>")
    		} else {
    			var groupName
	    		var groups = JSON.parse(usermeta).groups
	    		if (groups.length > 0) {
	    			groupName = []
	    			for (var i = 0; i < groups.length; i++) {
	    				groupName[i] = groups[i].groupName
	    			}
	    			sendPages(res, username, groupName, null, null, 'selectGroup', null)
	    		} else {
	    			sendPages(res, username, null, null, null, 'homepage/group', null)
	    		}
    		}
		})
    }
});

//Deal with select group
app.post('/selectGroup', function(req, res) {
    var username = req.body.username
    var groupName = req.body.groupName
    sendPages(res, username, groupName, null, null, 'homepage/tags', null)
});

//Show all the posts with tage life
app.get('/homepage/life', function(req, res) {
	var username = req.query.username
	var groupName = req.query.groupName
	sendPages(res, username, groupName, REORDER, 'life', 'homepage/tags', null)
});

//Show all the posts with tag study
app.get('/homepage/study', function(req, res) {
	var username = req.query.username
	var groupName = req.query.groupName
	sendPages(res, username, groupName, REORDER, 'study', 'homepage/tags', null)
});

//Show all the posts with tag work
app.get('/homepage/work', function(req, res) {
	var username = req.query.username
	var groupName = req.query.groupName
	sendPages(res, username, groupName, REORDER, 'work', 'homepage/tags', null)
	
});

//User logout
app.get('/homepage/logout', function(req, res) {
	var username = req.query.username
	res.end("<html> <header> BYE " + username + "! </header> </html>")
})

//Add a new comment to a post
app.post('/homepage/newComment', function(req, res) {
	var username = req.body.username
	var replyTo = req.body.replyTo
	var comment = req.body.comment
	var postName = req.body.postName
	var groupName = req.body.groupName
	stencil.updateFile(username, postName, groupName, replyTo, comment, function (){
		sendPages(res, username, groupName, REORDER, null, 'homepage/tags', null)
	})
})

function getSSHPubKeyFilePath(userID) {
	return defaultSSHKeysDir + '/' + userID + '.pub'
}

function getSSHKeyName(keyName) {
	return defaultSSHKeysDir + '/' + keyName
}

function getUserKeysDir(userID) {
	return userID + '/' + userKeysDir
}

function getLocalIpAddr() {
  var networkInterfaces = os.networkInterfaces( )
  return networkInterfaces.eth0[0].address
}

function getAdminReposDir(userID, serverAddr) {
	return 	userID + '/' + adminReposDir + '/' + serverAddr
}

function getRemoteRepoLocation(remoteRepoName, serverAddr) {
	return serverAddr + ':' + remoteRepoName
}

function getServerAddrWithoutUserAccount(serverAddr) {
	return serverAddr.split('@')[1]
}

function getWorkerLocalDHTNodeDB(pid) {
	return localDHTNodeDBFilePart + pid
}

function getWorkerLocalDHTPort(pid) {
	var portNum = pid % largestPortNum
	if (portNum < baseLocalDHTNodePort) {
		portNum += baseLocalDHTNodePort
	} 
	return portNum
}

function cloneRepoWithSpecificBranch(userID, groupName, serverAddr, branch) {
	var host = util.getHost(userID, groupName)
	var clonedRepoDir = util.getClonedReposDir(userID)
	var remoteRepoLocation = getRemoteRepoLocation(groupName, serverAddr)

	stencil.cloneRepoWithSpecificBranch(remoteRepoLocation, clonedRepoDir, host, userID, branch) 
}

function getSignature(value, privateKey) {
	var sign = crypto.createSign('SHA256')
	sign.update(value)
	sign.end()
	return sign.sign(privateKey, 'hex')
}

function addContentToJSONFileLocally(filePath, addedContent, callback) {
	fs.readFile(filePath, 'utf8', function(err, unprocessedFileContent) {

		var content
		if (unprocessedFileContent == undefined) {
			content = []
			content.push(addedContent)
		} else {
			content = JSON.parse(unprocessedFileContent)
			content.push(addedContent)
		}

		fs.writeFile(filePath, JSON.stringify(content), function(err) {
			callback()
		})
	})
}

//Notice: I have not added verification of data on the DHT!!!!!!!!
function getGroupInfoOnDHT(groupName, callback) {
	stencil.getValueFromDHT(localDHTNode, DHTSeed, groupName, function(metaOnDHT) {
		callback(metaOnDHT)
	})
}

function checkGroupExists(groupName, callback) {
	getGroupInfoOnDHT(groupName, function(groupMetaOnDHT){
		if (groupMetaOnDHT == undefined) {
			callback(false)
		} else {
			callback(true)
		}
	})
}

function getAllGroupsUserIn(userID, callback) {
	var reposDir = util.getClonedReposDir(userID)
	fs.readdir(reposDir, function(err, groups){
		callback(groups)
	})
}

function appendToMemList(groupName, userID, newMem, view, callback) {
	var host = util.getHost(userID, groupName)

	var repoPath = util.getClonedRepoPath(groupName, userID)
	var memListPath = util.getFilePathInRepo(repoPath, memListFile)
	var content = stencil.getFileFromRepo(memListPath, host, view)
	
	if (content == undefined) {
		var members = []
		members.push(newMem)
		stencil.createOrUpdateFileInRepo(memListPath, JSON.stringify(members), 'create', host, masterView, function() {
			callback()
		})
	} else {
		var members = JSON.parse(content)
		members.push(newMem)
		stencil.createOrUpdateFileInRepo(memListPath, JSON.stringify(members), 'update', host, masterView, function() {
			callback()
		})
	}

}

function addMember(groupName, newMem, SSHPublicKey, newMemHashedPublicKey, moderatorID, callback) {
	//appendToMemList(groupName, moderatorID, newMem, masterView, function() {
		var repoPath = util.getClonedRepoPath(groupName, moderatorID)
		var serverAddr = stencil.getServerAddr(repoPath)
		var adminRepoDir = getAdminReposDir(moderatorID, serverAddr)
		var host = util.getHost(moderatorID, groupName)

		stencil.addKeyAndUpdateConfigFileInAdminRepo(adminRepoDir, SSHPublicKey, newMemHashedPublicKey, groupName, host)

		var serverAddrWithoutUserAccount = getServerAddrWithoutUserAccount(serverAddr)
		var knownHostKey = stencil.getKnownHostKey(serverAddrWithoutUserAccount)

		callback(serverAddr, knownHostKey)
	//})
}

function processReq(username, hashedPublicKey, SSHPublicKey, groupName, moderatorID, callback) {
	var newMem = {}
	newMem.username = username
	newMem.hashedPublicKey = hashedPublicKey
	newMem.role = []
	newMem.role.push('normal')

	addMember(groupName, newMem, SSHPublicKey, hashedPublicKey, moderatorID, function(serverAddr, knownHostKey) {
		callback(serverAddr, knownHostKey)
	})
}

function joinGroupReq(data, moderatorAddr, callback) {
	var url = 'http://' + moderatorAddr + ':' + httpListeningPort + '/joinGroupRes'

	request({
    	url: url, 
    	method: 'POST',
    	form: data
	}, function (err, reply, body) {
		if (!err && reply.statusCode == 200) {
			var res = JSON.parse(body)
			if (res.type == 'Accept') {
				callback(false, res.knownHostKey, res.serverAddr)
			}
		} else {
			callback(true)
		}
	})
}

function joinGroup(username, hashedPublicKey, groupName, members, callback) {
	var member = members[0]
	members = _.rest(members)

	var SSHPkFilePath = getSSHPubKeyFilePath(hashedPublicKey)

	var SSHPublicKey = fs.readFileSync(SSHPkFilePath)

	var data = {
		username: username,
		groupName: groupName,
		hashedPublicKey: hashedPublicKey,
		SSHPublicKey: SSHPublicKey,
		moderatorID: member.hashedPublicKey
	}

	//currently, use the serial requests to privileged members
	joinGroupReq(data, member.address, function(retry, knownHostKey, serverAddr) {
		if (retry) {
			if (members.length != 0) {
				joinGroup(username, hashedPublicKey, groupName, members, callback)
			} else {
				callback('Cannot join for now!')
			}
		} else {
			var serverAddrWithoutUserAccount = getServerAddrWithoutUserAccount(serverAddr)
			stencil.checkAndAddKnownHostKey(serverAddrWithoutUserAccount, knownHostKey)

			cloneRepoWithSpecificBranch(hashedPublicKey, groupName, serverAddr, 'all')

			util.downloadPosts(groupName, hashedPublicKey, masterView, function() {

				var branchLockFilePath = util.getBranchLockFilePath(hashedPublicKey, groupName)
				util.createJSONFileLocally(branchLockFilePath, [], function() {

					createBotReq(hashedPublicKey, groupName, masterView, undefined, 'sync', function() {

						callback(null)
					})
				})
			})
		}
	})
}

//Send a dynamic page back
function sendPages(res, data, type) {
	var homepageGroup = 'homepage/group'
	var homepagePosts = 'homepage/posts'
	var homepageViews = 'homepage/views'

	if (type.indexOf(homepageGroup) != -1) {
		res.render('homepage', {username: JSON.stringify(data.username), posts: JSON.stringify([]),
					hashedPublicKey: JSON.stringify(data.hashedPublicKey), page: JSON.stringify(type),
					groupName: JSON.stringify(data.groupName), view: JSON.stringify(data.view)
		 	 	})
	} else if (type.indexOf(homepagePosts) != -1) {
		res.render('homepage', {username: JSON.stringify(data.username), posts: JSON.stringify(data.posts),
					hashedPublicKey: JSON.stringify(data.hashedPublicKey), page: JSON.stringify(type),
					groupName: JSON.stringify(data.groupName), view: JSON.stringify(data.view)
				})
	} else if (type.indexOf(homepageViews) != -1) {
		res.render('homepage', {username: JSON.stringify(data.username), posts: JSON.stringify([]),
					hashedPublicKey: JSON.stringify(data.hashedPublicKey), page: JSON.stringify(type),
					groupName: JSON.stringify(data.groupName), view: JSON.stringify(data.view)
				})
	}
}

function createGroup(groupName, description, userID, serverAddr, username, callback) {
	var host = util.getHost(userID, groupName)

	var adminRepoDir = getAdminReposDir(userID, serverAddr)
	stencil.setUpAdminRepoLocally(serverAddr, adminRepoDir, userID, host)

	stencil.createRepo(adminRepoDir, groupName, userID, host)

	cloneRepoWithSpecificBranch(userID, groupName, serverAddr, 'all')

	var repoPath = util.getClonedRepoPath(groupName, userID)

	var metaPutInRepo = {}
	metaPutInRepo.ts = new Date()
	
	var metaPath = util.getFilePathInRepo(repoPath, groupMetaFile)

	stencil.createOrUpdateFileInRepo(metaPath, JSON.stringify(metaPutInRepo), 'create', host, masterView, function() {
		var memListInRepo = []
		memListInRepo[0] = {}
		memListInRepo[0].role = []
		memListInRepo[0].role[0] = 'primary owner'
		memListInRepo[0].username = username
		memListInRepo[0].hashedPublicKey = userID
		
		var memListPath = util.getFilePathInRepo(repoPath, memListFile)

		stencil.createOrUpdateFileInRepo(memListPath, JSON.stringify(memListInRepo), 'create', host, masterView, function() {

			var metaPutOnDHT = {}
			metaPutOnDHT.description = description
			metaPutOnDHT.members = []
			metaPutOnDHT.members[0] = {}
			metaPutOnDHT.members[0].hashedPublicKey = userID
			metaPutOnDHT.members[0].address = getLocalIpAddr()

			var keysDir = getUserKeysDir(userID)
			var privateKey = getPrivateKeyLocally(keysDir)
			metaPutOnDHT.signature = getSignature(JSON.stringify(metaPutOnDHT), privateKey)			

			util.createOrUpdatePosts(groupName, userID, [], 'create', masterView, function() {

				var postsFileName = util.getDownloadedPostsFileName(groupName, masterView)
				var postsFilePath = util.getDownloadedFilePath(userID, postsFileName)
				util.createJSONFileLocally(postsFilePath, [], function() {

					createBotReq(userID, groupName, masterView, undefined, 'sync', function() {

						var branchLockFilePath = util.getBranchLockFilePath(userID, groupName)
						util.createJSONFileLocally(branchLockFilePath, [], function(){

							stencil.putValueOnDHT(localDHTNode, DHTSeed, groupName, metaPutOnDHT, function() {
								callback()
							})
						})
					})
				})
				
			})

		})
	})
}

function getPosts(groupName, userID, view, callback) {
	var postsFileName = util.getDownloadedPostsFileName(groupName, view)
	var postsFilePath = util.getDownloadedFilePath(userID, postsFileName)
	var repoPath = util.getClonedRepoPath(groupName, userID)

	util.lock(postsFilePath, function (release) {
		util.getJSONFileContentLocally(postsFilePath, function(posts) {
			release()
			callback(posts)
		})
	})
}

function startModeratorBot(arguments) {
	cluster.setupMaster({
		exec: 'moderator_bot.js',
		args: [ arguments.view, arguments.userID, arguments.groupName, arguments.filterKeyWords ],
		silent: true
	})

	var bot = cluster.fork()
	bot.on('message', messageHandlerInMaster)

	var moderatorBot = {}
	moderatorBot.pid = bot.process.pid
	moderatorBot.args = arguments
	moderatorBots.push(moderatorBot)
}

function startResponseBot(needSetUp) {
	if (needSetUp) {
		cluster.setupMaster({
			exec: 'app.js'
		})
	}
	
	var bot = cluster.fork()
	bot.on('message', messageHandlerInMaster)

	responseBots.push(bot.process.pid)
}

function startSyncBot(arguments) {
	cluster.setupMaster({
		exec: 'sync_bot.js',
		args: [ arguments.userID, arguments.groupName, arguments.view ],
		silent: true
	})
	var bot = cluster.fork()
	bot.on('message', messageHandlerInMaster)

	var syncBot = {}
	syncBot.pid = bot.process.pid
	syncBot.args = arguments
	syncBots.push(syncBot)
}

function checkBotExists(message) {
	var args

	for (var i in syncBots) {
		args = syncBots[i].args
		if (args.userID == message.userID && args.groupName == message.groupName && args.view == message.view) {
			return true
		}
	}

	for (var i in moderatorBots) {
		args = moderatorBots[i].args
		if (args.userID == message.userID && args.groupName == message.groupName && args.view == message.view && args.filterKeyWords == message.filterKeyWords) {
			return true
		}
	}

	return false
}

function messageHandlerInMaster(message) {
	// var find = checkBotExists(message)

	// if (!find) {
		if (message.type == 'createModeratorBot') {
			startModeratorBot(message)
		} else if (message.type == 'createSyncBot') {
			startSyncBot(message)
		} else {
			console.log(message)
		}
	//}
}

function restartBot(botPid) {
	var find = false

	for (var i in responseBots) {
		if (responseBots[i] == botPid) {
			find = true
			console.log(JSON.stringify(responseBots[i]))
			responseBots.splice(i, 1)
			startResponseBot(true)
			break
		}
	}

	if (!find) {
		for (var i in syncBots) {
			if (syncBots[i].pid == botPid) {
				find = true
				console.log(JSON.stringify(syncBots[i]))
				startSyncBot(syncBots[i].args)
				syncBots.splice(i, 1)
				break
			}
		}
	}

	if (!find) {
		for (var i in moderatorBots) {
			if (moderatorBots[i].pid == botPid) {
				find = true
				console.log(JSON.stringify(moderatorBots[i]))
				startModeratorBot(moderatorBots[i].args)
				moderatorBots.splice(i, 1)
				break
			}
		}
	}

}

function createBranchView(userID, groupName, view, filterKeyWords, callback) {
	var viewPostsFileName = util.getDownloadedPostsFileName(groupName, view)
	var viewPostsFilePath = util.getDownloadedFilePath(userID, viewPostsFileName)
	var masterViewPostsFileName = util.getDownloadedPostsFileName(groupName, masterView)
	var masterViewPostsFilePath = util.getDownloadedFilePath(userID, masterViewPostsFileName)
	var repoPath = util.getClonedRepoPath(groupName, userID)
	var branchLockFilePath = util.getBranchLockFilePath(userID, groupName)
	var rulesFilePath = util.getRulesFilePath(userID, groupName)
	var host = util.getHost(userID, groupName)

	stencil.createBranch(repoPath, view, function(err){
		if (err != null) {
			callback(err)
		} else {
			util.lock(masterViewPostsFilePath, function(releaseMasterViewPostsLock) {
				util.getJSONFileContentLocally(masterViewPostsFilePath, function(masterViewPosts) {
					releaseMasterViewPostsLock()
					var filteredPosts = util.filterPosts(masterViewPosts, filterKeyWords)

					util.lock(branchLockFilePath, function(releaseBranchLock) {
						stencil.changeBranch(repoPath, view, function(err) {
							util.createOrUpdatePosts(groupName, userID, filteredPosts, 'update', view, function(err) {
								var filter = {}
								filter.filterKeyWords = filterKeyWords

								stencil.createOrUpdateFileInRepo(rulesFilePath, JSON.stringify(filter), 'create', host, view, function() {
									releaseBranchLock()

									util.createJSONFileLocally(viewPostsFilePath, filteredPosts, function(){
										
										createBotReq(userID, groupName, view, filterKeyWords, 'moderator', function(err){
											callback(null)
										})
									})
								})
							})
						})
					})
				})
			})
		}
	})

}

function createBotReq(userID, groupName, view, filterKeyWords, type, callback) {
	if (type == 'sync') {
		var message = {}
		message.type = 'createSyncBot'
		message.userID = userID
		message.groupName = groupName
		message.view = view

		process.send(message)

		callback(null)
	} else if (type == 'moderator') {
		var message = {}
		message.type = 'createModeratorBot'
		message.view = view
		message.userID = userID
		message.groupName = groupName
		message.filterKeyWords = filterKeyWords

		process.send(message)

		callback(null)
	}
}

function getAllViews(groupName, userID) {
	var repoPath = util.getClonedRepoPath(groupName, userID)
	return stencil.getAllBranches(repoPath)
}

function addNewPost(newOne, postsFilePath, groupName, userID, view, callback) {
	var host = util.getHost(userID, groupName)
	var repoPath = util.getClonedRepoPath(groupName, userID)
	var postsMetaFilePath = util.getFilePathInRepo(repoPath, util.postsMetaFile)

	util.downloadPosts(groupName, userID, view, function(posts) {

		posts.push(newOne)

		util.createOrUpdatePosts(groupName, userID, posts, 'update', view, function(err) {
			if (!err) {
				util.createJSONFileLocally(postsFilePath, posts, function(){
					callback(posts)
				})
			} else {
				stencil.syncLocalAndRemoteBranches(repoPath, host, view, function(err, result){

					util.keepNewCommitAndRemoveOldOne(postsMetaFilePath, function(){

						addNewPost(newOne, postsFilePath, groupName, userID, view, callback)

					})
					
				})
			}
		})
	})
}

function newPost(title, groupName, hashedPublicKey, tag, postContent, view, callback) {
	var postsFileName = util.getDownloadedPostsFileName(groupName, masterView)
	var postsFilePath = util.getDownloadedFilePath(hashedPublicKey, postsFileName)
	var repoPath = util.getClonedRepoPath(groupName, hashedPublicKey)
	var branchLockFilePath = util.getBranchLockFilePath(hashedPublicKey, groupName)
	var rulesFilePath = util.getRulesFilePath(hashedPublicKey, groupName)

	util.lock(postsFilePath, function(releaseFileLock) {
		util.lock(branchLockFilePath, function(releaseBranchLock){

			stencil.changeBranch(repoPath, masterView, function(err) {
				var newOne = {}
				newOne.creator = hashedPublicKey
				newOne.ts = new Date()
				newOne.pContent = postContent
				newOne.title = title
				newOne.comments = []
				newOne.tag = tag

		    	addNewPost(newOne, postsFilePath, groupName, hashedPublicKey, masterView, function(masterViewPosts){
		    		releaseFileLock()

		    		if (view != masterView) {
		    			stencil.changeBranch(repoPath, view, function(err) {
			    			util.getJSONFileContentLocally(rulesFilePath, function(rules) {
			    				releaseBranchLock()

				    			var filteredPosts = util.filterPosts(masterViewPosts, rules.filterKeyWords)
				    			callback(filteredPosts)
			    			})
			    			
			    		})
		    		} else {
		    			releaseBranchLock()
		    			callback(masterViewPosts)
		    		}
		    		
		    	})	
			})
		})
	})
}

//Show all the posts
app.get('/renderPostsByTag', function(req, res) {
	var username = req.query.username
	var groupName = req.query.groupName
	var hashedPublicKey = req.query.hashedPublicKey
	var view = req.query.view
	var type = req.query.type

	var data = {}
	data.groupName = groupName
	data.username = username
	data.hashedPublicKey = hashedPublicKey
	data.view = view

	getPosts(groupName, hashedPublicKey, view, function(posts) {
		if (type == 'all') {
			data.posts = posts
		}
		sendPages(res, data, 'homepage/posts')
	})
})


if (cluster.isMaster) {
	for (var i = 0; i < numResponseBots; i++) {
        startResponseBot(false)
    }

	cluster.on('exit', function (worker, code, signal) {
		console.log('worker %d died (%s). restarting...', worker.process.pid, signal || code)
		restartBot(worker.process.pid)
	})

} else {
	var httpServer = http.createServer(app)

	stencil.createDHTNode(localDHTNodeAddr, getWorkerLocalDHTPort(process.pid), getWorkerLocalDHTNodeDB(process.pid), function(node) {
		localDHTNode = node

		httpServer.listen(httpListeningPort)
		console.log(process.pid + ' is listening at port %d', httpListeningPort)
	})

	app.post('/changeCurrentView', function(req, res) {
		var groupName = req.body.groupName
		var hashedPublicKey = req.body.hashedPublicKey
		var username = req.body.username
		var view = req.body.view
		var chosenView = req.body.chosenView

		var data = {}
		data.username = username
		data.groupName = groupName
		data.hashedPublicKey = hashedPublicKey
		data.view = chosenView

		//createBotReq(hashedPublicKey, groupName, chosenView, undefined, 'sync', function(err) {

			sendPages(res, data, 'homepage/views/changeView')
		//})
	})

	app.post('/findAllViews', function(req, res) {
		var groupName = req.body.groupName
		var userID = req.body.hashedPublicKey

		var data = {}
		data.views = getAllViews(groupName, userID)

		var result = '<html>' + JSON.stringify(data) + '</html>'
		res.end(result)
	})

	app.post('/createBranchView', function(req, res) {
		var username = req.body.username
		var groupName = req.body.groupName
		var hashedPublicKey = req.body.hashedPublicKey
		var newView = req.body.newView
		var filterKeyWords = req.body.filterKeyWords
		var currentView = req.body.currentView

		createBranchView(hashedPublicKey, groupName, newView, filterKeyWords, function(err) {
			var data = {}
			data.username = username
			data.groupName = groupName
			data.hashedPublicKey = hashedPublicKey
			data.view = currentView

			if (err != null) {
				sendPages(res, data, 'homepage/views/createBranchView/viewAlreadyExisted')
			} else {
				sendPages(res, data, 'homepage/views/createBranchView/createViewSuccessfully')
			}
		})
	})

	app.post('/refreshPosts', function(req, res) {
		var hashedPublicKey = req.body.hashedPublicKey
	    var groupName = req.body.groupName
	    var view = req.body.view

	    var repoPath = util.getClonedRepoPath(groupName, hashedPublicKey)

	    getPosts(groupName, hashedPublicKey, view, function(posts) {
	    	var data = {}
			data.posts = posts

			var result = '<html>' + JSON.stringify(data) + '</html>'
			res.end(result)
	    })
	})

	//New post
	app.post('/newPost', function(req, res) {
		var title = req.body.title
		var username = req.body.username
		var groupName = req.body.groupName
		var hashedPublicKey = req.body.hashedPublicKey
		var tag = req.body.tag
		var postContent = req.body.postContent
		var view = req.body.view
		
		newPost(title, groupName, hashedPublicKey, tag, postContent, view, function(posts) {
			var data = {}
			data.groupName = groupName
			data.username = username
			data.hashedPublicKey = hashedPublicKey
			data.posts = posts
			data.view = view

			sendPages(res, data, 'homepage/posts')
		})
	})

	//Create a group
	app.post('/createGroup', function(req, res) {
		var username = req.body.username
		var groupName = req.body.groupName
		var description = req.body.description
		var currentGroupName = req.body.currentGroupName
		var hashedPublicKey = req.body.hashedPublicKey
		var serverAddr = req.body.serverAddr
		var view = req.body.view

		var data = {}
		data.groupName = currentGroupName
		data.username = username
		data.hashedPublicKey = hashedPublicKey
		data.view = view

		checkGroupExists(groupName, function(exist) {
			if (exist) {
				sendPages(res, data, 'homepage/group/createOneGroup/AlreadyExisted')
			} else {
				createGroup(groupName, description, hashedPublicKey, serverAddr, username, function(){
					sendPages(res, data, 'homepage/group/createOneGroup/createGroupSuccessful')
				})
			}
		})
	})

	//User register
	app.post('/register', function(req, res) {
		var username = req.body.username

		createUser(username, function(hashedPublicKey) {
			var data = {}
			data.username = username
			data.hashedPublicKey = hashedPublicKey
			data.groupName = 'null'
			data.view = 'null'

			sendPages(res, data, 'homepage/group/notInAnyGroup')
		})
	})


	//Join a group
	app.post('/joinGroup', function(req, res) {
		var username = req.body.username
		var currentGroupName = req.body.currentGroupName
		var joinGroupName = req.body.joinGroupName
		var hashedPublicKey = req.body.hashedPublicKey
		var view = req.body.view

		var data = {}
		data.username = username
		data.groupName = currentGroupName
		data.hashedPublicKey = hashedPublicKey
		data.view = view

		getGroupInfoOnDHT(joinGroupName, function(groupMetaOnDHT) {
			if (groupMetaOnDHT == undefined || groupMetaOnDHT == null) {
				sendPages(res, data, 'homepage/group/joinOneGroup/GroupNotExisted')
			} else {
				var members = groupMetaOnDHT.members
				joinGroup(username, hashedPublicKey, joinGroupName, members, function(err){
					if (err != null) {
						res.end(err)
					} else {
						sendPages(res, data, 'homepage/group/joinOneGroup/joinGroupSuccessfully')
					}
				})
			}
		})
	})

	app.post('/joinGroupRes', function(req, res) {
		var username = req.body.username
		var hashedPublicKey = req.body.hashedPublicKey
		var groupName = req.body.groupName
		var SSHPublicKey = req.body.SSHPublicKey
		var moderatorID = req.body.moderatorID

		processReq(username, hashedPublicKey, SSHPublicKey, groupName, moderatorID, function(serverAddr, knownHostKey){
			var response = {}
			response.type = 'Accept'
			response.knownHostKey = knownHostKey
			response.serverAddr = serverAddr

			res.write(JSON.stringify(response))
			res.end()
		})
	})

	app.post('/findAllGroups', function(req, res) {
		var hashedPublicKey = req.body.hashedPublicKey

		getAllGroupsUserIn(hashedPublicKey, function(groups) {
			var data = {}
			data.groups = groups
			var result = '<html>' + JSON.stringify(data) + '</html>'
			res.end(result)
		})
	})

	//Change current group
	app.post('/changeCurrentGroup', function(req, res){
		var currentGroupName = req.body.currentGroupName
		var username = req.body.username
		var chosenGroup = req.body.chosenGroup
		var hashedPublicKey = req.body.hashedPublicKey
		var view = req.body.view

		var data = {}
		data.groupName = chosenGroup
		data.username = username
		data.hashedPublicKey = hashedPublicKey

		if (currentGroupName == chosenGroup) {
			data.view = view
			sendPages(res, data, 'homepage/group/changeCurrentGroup/NoNeedToChange')
		} else {
			data.view = masterView
			sendPages(res, data, 'homepage/group/changeCurrentGroup/ChangeGroupSuccessfully')
		}
	})
}
