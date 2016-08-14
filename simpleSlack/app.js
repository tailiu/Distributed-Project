var express = require('express')
var querystring = require('querystring')
var bodyParser = require('body-parser')
var stencil = require('./stencil')
var deasync = require('deasync')
var app = express()
var childProcess = require('child-proc')
var os = require('os')
var NodeRSA = require('node-rsa')
var crypto = require('crypto')
var nodemailer = require('nodemailer')
var _ = require('underscore')
var request = require('request')
var fs = require('graceful-fs')
var http = require('http')
var https = require('https')
var mkdirp = require('mkdirp')

const slackEmailDomain = 'stencil.slack@gmail.com'

const httpListeningPort = 3000

//stencil public key in pem format
const stencilPublicKey = 
'-----BEGIN RSA PUBLIC KEY-----\n' + 
'MIIBCgKCAQEAj5Xs9wrANKOgrrwnisI11K6Q0frtRS9zD0LsAY0QHC5Om0ewso6f\n' + 
'laSyjfsRwxsupVRN/881Dxz4adtrZk3jYZ6wzg2zU1F8XIkSyj/cCeKherOtmjCW\n'+ 
'cAZmhYZsguBQqznrRc7wWannxvFPjvGqNnQnUoKeqbdzjooD0+bzBoKrROwDdDEh\n' + 
'83ID76CagN3BtjZ49kBRfjqXjYBgCBLS6644dousLdBBjNoHj8uveyavAxLar+4w\n' + 
'4i16uVBnUlhLYCuflEiXoFkSHuA2IMb3SCUSZKDRQQ9TyTiAbMNNYLUSdkC3NF5+\n' +  
'JAPr9UUyUbaorLEHNzhRqFLK2MCBdLZ9KQIDAQAB\n' + 
'-----END RSA PUBLIC KEY-----'

//slack public key in pem format
const slackPublicKey = 
'-----BEGIN RSA PUBLIC KEY-----\n' + 
'MIIBCgKCAQEA1xAEIRvuuiRJupUZnzq8MF1GtKjuPckTKJ8bW7RdrOK4pETZlUSq\n' +  
'TRsnrqMzgdEHmqZqQyDEY61uvRMg3ZlLQ9KZEVZfSEpZ1mkcXMji//Pl0AZaQVN+\n' + 
'POmEc0eVVRGOEnBAh9aexQXDLi3LLPb3PGS/juqZ1ft/G884w+wd3yBz9rDkGu+8\n' + 
'ZcxHMRvuCQWOlF6L14f4RQL9VrMxLqTw7Exv4IT2ZjYaMJ/Qoj9CXBTs8jXKQ4W5\n' + 
'bXlNjnjiXv1u/nx/hf+ZSU5KX07YLE1JrDEqJgvsZ/vj5MZDYvwOzkx4q04rw9F6\n' + 
'BYFS1EgW5jtJ1Rm4QW6x91m0f8XDkFuE7QIDAQAB\n' + 
'-----END RSA PUBLIC KEY-----'

const hashedStencilPublicKey = calculateHash(stencilPublicKey)
const hashedSlackPublicKey = calculateHash(slackPublicKey)

const localDHTNodeAddr = 'localhost'
const localDHTNodePort = 7200
const localDHTNodeDB = 'db2'

const DHTSeed = {
 	address: '127.0.0.1',
	port: 8200
}

const adminReposDir = 'admin_repos'
const adminFile = 'gitolite-admin'
const clonedReposDir = 'cloned_repos'
const uploadedFilesDir = 'uploaded_files'
const messageLogMeta = 'message_log_meta'
const channelMetaFile = 'channel_meta'
const teamMetaFile = 'team_meta'
const downloadedFilesDir = 'downloaded_files'
const invitationMetaFile = 'invitation_meta'
const publicKeyFile = 'public_key'
const memListFile = 'member_list'
const metaFile = 'meta'
const reposFile = 'repos'
const usermetaFile = 'user_meta'
const publicChannelsFile = 'public_channels'
const SSHKeysDir = '/home/'+ findCurrentAccount() + '/.ssh'
const SSHPkFilePath = SSHKeysDir + '/id_rsa.pub'
const knownHostsPath = '/home/' + findCurrentAccount() + '/.ssh/known_hosts'

// create reusable transporter object using the default SMTP transport
var transporter = nodemailer.createTransport(smtpConfig);
var smtpConfig = {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: slackEmailDomain
    }
}

var localDHTNode

app.set('views', './views/jade')
app.set('view engine', 'jade')
app.use(bodyParser.json())       	// to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
	extended: true
}))

// send mail with defined transport object
function sendEmail(mailOptions, callback) {
	transporter.sendMail(mailOptions, function(error, info){
		callback()
	})
}

function createRandom() {
  var current_date = (new Date()).valueOf().toString();
  var random = Math.random().toString();
  return crypto.createHash('sha1').update(current_date + random).digest('hex');
}

function getLocalIpAddr() {
  var networkInterfaces = os.networkInterfaces( )
  return networkInterfaces.eth0[0].address
}

//find current account on the machine
function findCurrentAccount() {
  var account = childProcess.execSync('whoami')
  account = (account + '').replace(/(\r\n|\n|\r)/gm,"")
  return account
}

//Initial page
app.post('/initial-page', function(req, res) {
    if (req.body.createNewTeam != undefined) {
    	res.render('createTeam')
    }
})

//User logout
app.get('/logout', function(req, res) {
	var username = req.query.username
	res.end("<html> <header> BYE " + username + "! </header> </html>")
})

function getJSONFileContentLocally(filePath, callback) {
	if (!fs.existsSync(filePath)) {
		callback(undefined)
	}
	fs.readFile(filePath, 'utf8', function(err, unprocessedFileContent) {
		if (unprocessedFileContent == undefined) {
			callback(undefined)
		} else {
			callback(JSON.parse(unprocessedFileContent))
		}
	})
}

function getMessageLogContent(repoPath, userID, callback) {
	var messageLogMetaPath = getFilePathInRepo(repoPath, messageLogMeta)
	getJSONFileContentLocally(messageLogMetaPath, function(messageLogMetaContent) {
		var messageLogFileName = createRandom()
		var messageLogFilePath = getDownloadedFilesPath(userID, messageLogFileName)
		stencil.getFileFromTorrent(messageLogMetaContent.seeds, messageLogFilePath, function() {
			getJSONFileContentLocally(messageLogFilePath, function(messageLogContent) {
				callback(messageLogContent)
			})
		})
	})
}
function getMemList(teamNameOrChannelName, userID) {
	var repoPath = getClonedRepoPath(teamNameOrChannelName, userID)
	var memListPath = getFilePathInRepo(repoPath, memListFile)
	var memList = JSON.parse(stencil.getFileFromRepo(memListPath))
	return memList
}

function replaceHashedPublicKeyWithUserName(messageLogContent, userID, channelName) {
	var memList = getMemList(channelName, userID)
	
	for (var i in messageLogContent) {
		for (var j in memList) {
			if (messageLogContent[i].creator == memList[j].hashedPublicKey) {
				messageLogContent[i].creator = memList[j].username
				break
			}
		}
	}
	return messageLogContent
}

app.get('/renderChannel', function(req, res) {
	var hashedPublicKey = req.query.hashedPublicKey
	var username = req.query.username
	var readableTeamName = req.query.readableTeamName
	var flatTeamName = req.query.flatTeamName
	var flatCName = req.query.flatCName

	var data = {}
	data.hashedPublicKey = hashedPublicKey
	data.username = username
	data.readableTeamName = readableTeamName
	data.flatTeamName = flatTeamName
	data.flatCName = flatCName

	var channelRepoPath = getClonedRepoPath(flatCName, hashedPublicKey)
	stencil.syncRepo(channelRepoPath, function() {
		getMessageLogContent(channelRepoPath, hashedPublicKey, function(messageLogContent) {
			data.msgs = replaceHashedPublicKeyWithUserName(messageLogContent, hashedPublicKey, flatCName)
			sendPages(res, data, '/homepage/channels/renderChannel')
		})
	})
})

app.post('/refreshChannelMsgs', function(req, res) {
    var hashedPublicKey = req.body.hashedPublicKey
    var flatTeamName = req.body.flatTeamName
    var chosenChannel = req.body.chosenChannel

    var data = {}

    var channelRepoPath = getClonedRepoPath(chosenChannel, hashedPublicKey)
	stencil.syncRepo(channelRepoPath, function(updated) {
		data.updated = updated
		if (updated) {
			getMessageLogContent(channelRepoPath, hashedPublicKey, function(messageLogContent) {
    			data.msgs = replaceHashedPublicKeyWithUserName(messageLogContent, hashedPublicKey, chosenChannel)
				var result = '<html>' + JSON.stringify(data) + '</html>'
				res.end(result)
			})
		} else {
			var result = '<html>' + JSON.stringify(data) + '</html>'
			res.end(result)
		}
	})    

})

function createOrUpdateMesageLogContent(userID, content, repoPath, option, callback) {
	var fileDir = getUploadedFilesDir(userID)
	createTmpFile(fileDir, JSON.stringify(content), function(filePath) {
		stencil.createFileInTorrent(filePath, function(filemeta) {
			var messageLogMetaPath = getFilePathInRepo(repoPath, messageLogMeta)
			stencil.createOrUpdateFileInRepo(messageLogMetaPath, JSON.stringify(filemeta), option, function(retry) {
				callback(retry)
			})
		})
	})
}

function updateMsg(userID, flatCName, message, callback) {
	var channelRepoPath = getClonedRepoPath(flatCName, userID)
	getMessageLogContent(channelRepoPath, userID, function(messageLogContent) {

		var newMsg = {}
		newMsg.msg = message
		newMsg.creator = userID
		newMsg.ts = new Date()
		messageLogContent.push(newMsg)

		createOrUpdateMesageLogContent(userID, messageLogContent, channelRepoPath, 'update', function(retry) {
			if (!retry) {
				callback(messageLogContent)
			} else {
				updateMsg(userID, flatCName, message, callback)
			}
		})					
	})
}

app.post('/userMsg', function(req, res) {
	var hashedPublicKey = req.body.hashedPublicKey
	var username = req.body.username
	var readableTeamName = req.body.readableTeamName
	var flatTeamName = req.body.flatTeamName 
	var flatCName = req.body.flatCName
	var message = req.body.message

	var data = {}
	data.hashedPublicKey = hashedPublicKey
	data.username = username
	data.readableTeamName = readableTeamName
	data.flatTeamName = flatTeamName
	data.flatCName = flatCName

	updateMsg(hashedPublicKey, flatCName, message, function(messageLogContent) {
		data.msgs = replaceHashedPublicKeyWithUserName(messageLogContent, hashedPublicKey, flatCName)
		sendPages(res, data, '/homepage/channels/renderChannel')
	})
})

app.post('/getChannels', function(req, res) {
	var data = {}
	data.username = req.body.username
	data.hashedPublicKey = req.body.hashedPublicKey
	data.flatTeamName = req.body.flatTeamName
	data.readableTeamName = req.body.readableTeamName

	sendPages(res, data, '/homepage/channels/getChannels')
})

//Store the public key to 'email-public.pem' and the private to 'email-private.pem'
//This is just a temporary method, because in the development, I need to test 
//using different users on the same machine 
function createPublicKeyPair(keyPath) {
	var command = 'openssl genrsa -out ' + keyPath + '-private.pem 2048\n'
	command += 'openssl rsa -in ' + keyPath + '-private.pem -pubout > ' + keyPath + '-public.pem\n'

	childProcess.execSync(command)
}

function createCertificate(path) {
	command = 'openssl req -new -sha256 -key ' + path + '-private.pem -out ' + path + '-csr.pem '
	command += '-subj "/C=US/ST=NY/L=NY/O=NYU/CN=192.168.0.1"\n'
	command += 'openssl x509 -req -in ' + path + '-csr.pem -signkey '  + path + '-private.pem -out ' + path + '-cert.pem\n'

	childProcess.execSync(command)
}

function createUser(keyPath, callback) {
	createPublicKeyPair(keyPath)
	createCertificate(keyPath)

	var publicKey = getPublicKey(keyPath)
	var	privateKey = getPrivateKey(keyPath)

	var localUserMeta = {}
	localUserMeta.ts = new Date()

	var hashedPublicKey = calculateHash(publicKey)
	mkdirp.sync(hashedPublicKey)

	fs.writeFile(hashedPublicKey + '/' + usermetaFile, JSON.stringify(localUserMeta), function(err) {
		callback(publicKey, privateKey)
	})
}

function calculateHash(value) {
	var hash = crypto.createHash('sha256')
	hash.update(value)
	return hash.digest('hex')
}

function getPrivateKey(keyPath) {
	return fs.readFileSync(keyPath + '-private.pem', 'utf8')
}

function getPublicKey(keyPath) {
	var publicKey
	try {
		publicKey = fs.readFileSync(keyPath + '-public.pem', 'utf8')
	} catch (err) {
		publicKey = undefined
	}
	return publicKey
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

function createTeamOrChannel(userID, serverAddr, email, description, readableName, username, teamName, option, callback) {
	var label = createRandom()
	name = hashedStencilPublicKey + ':' + hashedSlackPublicKey + ':' + label
	repoName = label

	createPublicKeyPair(name)
	var publicKey = getPublicKey(name)
	var privateKey = getPrivateKey(name)

	var metaPutInInRepo = {}
	metaPutInInRepo.description = description			
	metaPutInInRepo.ts = new Date()

	var adminRepoDir = getAdminReposDir(userID, serverAddr)
	var repoPath = getClonedRepoPath(name, userID)

	var metaPath
	if (option == 'team') {
		metaPutInInRepo.name = readableName
		metaPath = getFilePathInRepo(repoPath, teamMetaFile)
		stencil.setUpAdminRepoLocally(serverAddr, adminRepoDir, userID)
	} else if (option == 'private channel') {
		metaPutInInRepo.name = readableName
		metaPutInInRepo.teamName = teamName
		metaPath = getFilePathInRepo(repoPath, channelMetaFile)
		stencil.setUpAdminRepoLocally(serverAddr, adminRepoDir, userID)
	} else {
		metaPath = getFilePathInRepo(repoPath, channelMetaFile)
	}

	stencil.createRepo(adminRepoDir, repoName, userID)
	cloneRepo(userID, name, serverAddr)
	
	stencil.createOrUpdateFileInRepo(metaPath, JSON.stringify(metaPutInInRepo), 'create', function() {

		var MemListInRepo = []
		MemListInRepo[0] = {}
		MemListInRepo[0].username = username
		MemListInRepo[0].hashedPublicKey = userID
		MemListInRepo[0].email = email
		MemListInRepo[0].role = []
		MemListInRepo[0].role[0] = 'creator'

		var memListPath = getFilePathInRepo(repoPath, memListFile)

		stencil.createOrUpdateFileInRepo(memListPath, JSON.stringify(MemListInRepo), 'create', function() {

			var publicKeyPath = getFilePathInRepo(repoPath, publicKeyFile)

			stencil.createOrUpdateFileInRepo(publicKeyPath, publicKey, 'create', function() {

				var reposFilePath = getFilePathInUserIDDir(userID, reposFile)

				addContentToJSONFileLocally(reposFilePath, name, function() {

					if (option == 'general channel') {
						var channelInfo = {}
						channelInfo.readableName = readableName
						channelInfo.flatName = name

						var teamRepoPath = getClonedRepoPath(teamName, userID)
						var publicChannelsFilePath = getFilePathInRepo(teamRepoPath, publicChannelsFile)

						addContentToJSONFileInRepo(publicChannelsFilePath, channelInfo, function() {

							createOrUpdateMesageLogContent(userID, [], repoPath, 'create', function() {
								callback()
							})

						})
					} else {
						var metaPutOnDHT = {}
						metaPutOnDHT.members = []
						metaPutOnDHT.members[0] = {}
						metaPutOnDHT.members[0].hashedPublicKey = userID
						metaPutOnDHT.members[0].address = getLocalIpAddr()
						metaPutOnDHT.signature = getSignature(JSON.stringify(metaPutOnDHT), privateKey)

						stencil.putValueOnDHT(localDHTNode, DHTSeed, name, metaPutOnDHT, function() {

							if (option == 'public channel') {
								var channelInfo = {}
								channelInfo.readableName = readableName
								channelInfo.flatName = name

								var teamRepoPath = getClonedRepoPath(teamName, userID)
								var publicChannelsFilePath = getFilePathInRepo(teamRepoPath, publicChannelsFile)

								addContentToJSONFileInRepo(publicChannelsFilePath, channelInfo, function() {

									createOrUpdateMesageLogContent(userID, [], repoPath, 'create', function() {
										callback()
									})

								})
							} else if (option == 'private channel') {
								createOrUpdateMesageLogContent(userID, [], repoPath, 'create', function() {
									callback()
								})
							} else {
								callback(name)
							}
							
						})

					}
					
				})
			})
		})
	})
}

app.post('/newChannel', function(req, res) {
    var readableName = req.body.channelName
    var hashedPublicKey = req.body.hashedPublicKey
	var username = req.body.username
	var readableTeamName = req.body.readableTeamName
	var flatTeamName = req.body.flatTeamName
	var channelType = req.body.type
	var serverAddr = req.body.serverAddr
	var purpose = req.body.purpose

	var repoPath = getClonedRepoPath(flatTeamName, hashedPublicKey)
	if (serverAddr == undefined) {
		serverAddr = stencil.getServerAddr(repoPath)
	}

	var email = getUserEamil(flatTeamName, hashedPublicKey)

	createTeamOrChannel(hashedPublicKey, serverAddr, email, purpose, readableName, username, flatTeamName, channelType, function() {
		var data = {}
		data.flatTeamName = flatTeamName
		data.readableTeamName = readableTeamName
		data.username = username
		data.hashedPublicKey = hashedPublicKey

		sendPages(res, data, '/homepage/channels/getChannels')

	})

})

function findAllMembers(userID, teamOrChannelName) {
	var repoPath = getClonedRepoPath(teamOrChannelName, userID)
	var memListPath = getFilePathInRepo(repoPath, memListFile)
	return JSON.parse(stencil.getFileFromRepo(memListPath))	
}

function getMemberListDifference(listOne, listTwo) {
	var difference = []
	for (var i = 0; i < listOne.length; i++) {
		var find = false
		for (var j = 0; j < listTwo.length; j++) {
			if (listOne[i].hashedPublicKey == listTwo[j].hashedPublicKey) {
				find = true
				break
			}
		}
		if (!find) {
			difference.push(listOne[i])
		}
	}
	return difference
}

app.post('/getChannelInviteeList', function(req, res) {
	var hashedPublicKey = req.body.hashedPublicKey
    var flatTeamName = req.body.flatTeamName
    var chosenChannel = req.body.chosenChannel  

    var teamMems = findAllMembers(hashedPublicKey, flatTeamName)	
    var channelMems = findAllMembers(hashedPublicKey, chosenChannel)
    	
    var data = {}

    var inviteeList = getMemberListDifference(teamMems, channelMems)
	if (inviteeList.length == 0) {
		data.inviteeListEmpty = true
	} else {
		data.inviteeListEmpty = false
	}
	data.inviteeList = inviteeList

	var result = '<html>' + JSON.stringify(data) + '</html>'
	res.end(result)
	 
})

function getSignature(value, privateKey) {
	var sign = crypto.createSign('SHA256')
	sign.update(value)
	sign.end()
	return sign.sign(privateKey, 'hex')
}

function getClonedReposDir(userID) {
	return userID + '/' + clonedReposDir
}

function getFilePathInRepo(repoPath, relativeFilePathInRepo) {
	return repoPath + '/' + relativeFilePathInRepo
}

function getAdminReposDir(userID, serverAddr) {
	return 	userID + '/' + adminReposDir + '/' + serverAddr
}

function getRemoteRepoLocation(remoteRepoName, serverAddr) {
	return serverAddr + ':' + remoteRepoName
}

function getFilePathInUserIDDir(userID, relativeFilePathInUserIDDir) {
	return userID + '/' + relativeFilePathInUserIDDir
}

function getUploadedFilesDir(userID) {
	return userID + '/' + uploadedFilesDir
}

function getDownloadedFilesPath(userID, fileName) {
	return userID + '/' + downloadedFilesDir + '/' + fileName
}

function getRepoNameFromTeamOrChannelName(teamNameOrChannelName) {
	return teamNameOrChannelName.split(':')[2]
}

function getClonedRepoPath(teamOrChannelName, userID) {
	var teamOrChannelRepoName = getRepoNameFromTeamOrChannelName(teamOrChannelName)
	var clonedRepoDir = getClonedReposDir(userID)
	return clonedRepoDir + '/' + teamOrChannelRepoName
}

function addContentToJSONFileInRepo(filePath, addedContent, callback) {
	var unprocessedFileContent = stencil.getFileFromRepo(filePath)
	var option
	var content

	if (unprocessedFileContent == undefined) {
		content = []
		content.push(addedContent)
		option = 'create'
	} else {
		content = JSON.parse(unprocessedFileContent)
		content.push(addedContent)
		option = 'update'
	}

	stencil.createOrUpdateFileInRepo(filePath, JSON.stringify(content), 'create', function() {
		callback()
	})
}

function createTmpFile(fileDir, content, callback) {
	var fileName = createRandom()
	if (!fs.existsSync(fileDir)) {
		mkdirp.sync(fileDir)
	} 
	filePath = fileDir + '/' + fileName
	fs.writeFile(filePath, content, function(err) {
		callback(filePath)
	})
}

function cloneRepo(userID, teamOrChannelName, serverAddr) {
	var clonedRepoDir = getClonedReposDir(userID)
	var repoName = getRepoNameFromTeamOrChannelName(teamOrChannelName)
	var remoteTeamRepoLocation = getRemoteRepoLocation(repoName, serverAddr)
	stencil.cloneRepo(remoteTeamRepoLocation, clonedRepoDir) 
}

//Create a team
app.post('/createTeam', function(req, res) {
	var email = req.body.email
	var username = req.body.username
	var readableTeamName = req.body.teamName
	var serverAddr = req.body.remote
	var description = req.body.description

	var done = false
	var creatorPublicKey

	//store public key and private key in email-public.pem and email-private.pem respectively.
	//This is an expedient method to distinguish different users on the local machine for testing use.
	//In the future, the key should be stored locally in a well-known place
	creatorPublicKey = getPublicKey(email)
	if (creatorPublicKey == undefined) {
		createUser(email, function(pubKey, priKey) {
			creatorPublicKey = pubKey
			done = true
		})
	} else {
		done = true
	}
	deasync.loopWhile(function(){return !done})

	var userID = calculateHash(creatorPublicKey)

	createTeamOrChannel(userID, serverAddr, email, description, readableTeamName, username, null, 'team', function(teamName) {

		var generalChannelDescription = 'team wide communication and announcement'
		var generalChannelReadableName = 'general'
		createTeamOrChannel(userID, serverAddr, email, generalChannelDescription, generalChannelReadableName, username, teamName, 'general channel', function() {

			var data = {}
			data.flatTeamName = teamName
			data.readableTeamName = readableTeamName
			data.username = username
			data.hashedPublicKey = userID
			sendPages(res, data, '/homepage/channels/getChannels')

		})

	})

})

function sendInvitationEmail(flatTeamNameOrChannelName, readableTeamOrChannelName, hashedPublicKey, username, inviteeEmails, additionalInfo, callback) {
	var repoPath = getClonedRepoPath(flatTeamNameOrChannelName, hashedPublicKey)
	var publicKeyFilePath = getFilePathInRepo(repoPath, publicKeyFile)
	var teamOrChannelPublicKey = stencil.getFileFromRepo(publicKeyFilePath)
	var encodedPublicKey = encodeURIComponent(teamOrChannelPublicKey)

	var invitationID = createRandom()

	var inviteeEmail = inviteeEmails[0]
	inviteeEmails = _.rest(inviteeEmails)

	if (additionalInfo.option == 'team') {
		var url = 'http://localhost:' + httpListeningPort + '/acceptInvitationToTeam'
		url += '?team=' + flatTeamNameOrChannelName + '&&invitationID=' +  invitationID
		url += '&&inviteeEmail=' + inviteeEmail + '&&encodedPublicKey=' + encodedPublicKey
		var subject = username + ' invited you to team ' + readableTeamOrChannelName + ' on Stencil Slack'
		var body = '<p>' + username + ' uses Stencil Slack, a P2P messaging app using Stencil Storage API'
		body += ' for teams, and has invited you to join the team ' + readableTeamOrChannelName + '</p><br><br>'
		body += '<a href="'+ url +'"><b><i>Join Team</b></i></a>'
		 
	} else {
		var url = 'http://localhost:' + httpListeningPort + '/acceptInvitationToChannel'
		url += '?channel=' + flatTeamNameOrChannelName + '&&invitationID=' +  invitationID + '&&team=' + additionalInfo.flatTeamName
		url += '&&encodedPublicKey=' + encodedPublicKey
		var subject = username + ' invited you to channel ' + readableTeamOrChannelName + ' of team ' + additionalInfo.readableTeamName + ' on Stencil Slack'
		var body = '<a href="'+ url +'"><b><i>Join Channel</b></i></a>'
	}

	// setup e-mail data with unicode symbols
	var mailOptions = {
	    from: '"Stencil Slack" <stencil.slack@gmail.com>', 	// sender address
	    to: inviteeEmail, 									// list of receivers
	    subject: subject, 									// Subject line
	    html: body 											// html body
	}

	var newInvitation = {}
	newInvitation.hashedInviterPublicKey = hashedPublicKey
	newInvitation.inviteeEmail = inviteeEmail
	newInvitation.inviteTs = new Date()
	newInvitation.status = 'pending'
	newInvitation.invitationID = invitationID

	var invitationMetaFilePath = getFilePathInRepo(repoPath, invitationMetaFile)

	addContentToJSONFileInRepo(invitationMetaFilePath, newInvitation, function() {
		sendEmail(mailOptions, function () {
			if (inviteeEmails.length == 0) {
				callback()
			} else {
				sendInvitationEmail(flatTeamNameOrChannelName, readableTeamOrChannelName, hashedPublicKey, username, inviteeEmails, additionalInfo, callback)
			}
		})
	})
}

function checkAlreadyInTeamOrChannel(email, teamOrChannelName, userID) {
	var repoPath = getClonedRepoPath(teamOrChannelName, userID)
	var memListPath = getFilePathInRepo(repoPath, memListFile)
	var memList = JSON.parse(stencil.getFileFromRepo(memListPath))
	for (var i in memList) {
		if(memList[i].email == email) {
			return true
		}
	}
	return false
}

function getUserEamil(teamName, userID) {
	var repoPath = getClonedRepoPath(teamName, userID)
	var memListPath = getFilePathInRepo(repoPath, memListFile)
	var members = JSON.parse(stencil.getFileFromRepo(memListPath))
	for (var i in members) {
		if (members[i].hashedPublicKey == userID) {
			return members[i].email
		}
	}
	return undefined
}

app.post('/inviteToChannel', function(req, res) {
	var list = req.body.inviteeList
	var hashedPublicKey = req.body.hashedPublicKey
    var flatTeamName = req.body.flatTeamName
    var chosenChannel = req.body.chosenChannel  
    var username = req.body.username
    var readableTeamName = req.body.readableTeamName

    var additionalInfo = {}
	additionalInfo.option = 'channel'
	additionalInfo.readableTeamName = readableTeamName
	additionalInfo.flatTeamName = flatTeamName

	var inviteeList
	if (_.isArray(list)){
		inviteeList = list
	} else {
		inviteeList = []
		inviteeList.push(list)
	}

	var inviteeEmails = []
	for (var i in inviteeList) {
		var email = getUserEamil(flatTeamName, inviteeList[i])
		inviteeEmails.push(email)
	}

	findChannelsUserIn(hashedPublicKey, flatTeamName, function(channelsUserIn) {
		for (var i in channelsUserIn) {
			if (channelsUserIn[i].flatName == chosenChannel) {
				var readableName = channelsUserIn[i].readableName
				break
			}
		}

		sendInvitationEmail(chosenChannel, readableName, hashedPublicKey, username, inviteeEmails, additionalInfo, function() {

			var data = {}
			data.hashedPublicKey = hashedPublicKey
			data.username = username
			data.readableTeamName = readableTeamName
			data.flatTeamName = flatTeamName
			data.flatCName = chosenChannel

			var channelRepoPath = getClonedRepoPath(chosenChannel, hashedPublicKey)
			stencil.syncRepo(channelRepoPath, function() {
				getMessageLogContent(channelRepoPath, hashedPublicKey, function(messageLogContent) {
					data.msgs = replaceHashedPublicKeyWithUserName(messageLogContent, hashedPublicKey, chosenChannel)
					sendPages(res, data, '/homepage/channels/renderChannel')
				})
			})
		})
	})
})

app.post('/inviteToTeam', function(req, res) {
	var hashedPublicKey = req.body.hashedPublicKey
	var flatTeamName = req.body.flatTeamName
	var inviteeEmail = req.body.inviteeEmail
	var readableTeamName = req.body.readableTeamName
	var username = req.body.username

	var data = {}
	data.flatTeamName = flatTeamName
	data.readableTeamName = readableTeamName
	data.username = username
	data.hashedPublicKey = hashedPublicKey

	var alreadyInTeam = checkAlreadyInTeamOrChannel(inviteeEmail, flatTeamName, hashedPublicKey)

	if (alreadyInTeam) {
		sendPages(res, data, '/homepage/team/inviteToTeam/alreadyInTeam')
	} else {
		var additionalInfo = {}
		additionalInfo.option = 'team'

		var inviteeEmails = []
		inviteeEmails.push(inviteeEmail)

		sendInvitationEmail(flatTeamName, readableTeamName, hashedPublicKey, username, inviteeEmails, additionalInfo, function() {
			sendPages(res, data, '/homepage/team/inviteToTeam/sentEmail')
		})
	}
})

function verifySignature(value, publicKey, signature) {
	var verify = crypto.createVerify('SHA256')
	verify.update(value)
	verify.end()
	return verify.verify(publicKey, signature, 'hex')
}

function verifyValue(publicKey, value) {
	var checkedValue = _.clone(value)
	delete checkedValue['signature']
	var result = verifySignature(JSON.stringify(checkedValue), publicKey, value.signature)
	return result
}

app.get('/acceptInvitationToChannel', function(req, res) {
	var flatChannelName = req.query.channel
	var invitationID = req.query.invitationID
	var encodedPublicKey = req.query.encodedPublicKey
	var flatTeamName = req.query.team

	//get the local public key, for now, I just hardcode it
	inviteePublicKey = getPublicKey('tl67@nyu.edu')
	
	var hashedInviteePublicKey = calculateHash(inviteePublicKey)

	acceptInvitation(hashedInviteePublicKey, encodedPublicKey, undefined, flatChannelName, invitationID, flatTeamName, undefined, function(readableTeamName) {
		var data = {}
		data.hashedPublicKey = hashedInviteePublicKey
		data.readableTeamName = readableTeamName
		data.flatTeamName = flatTeamName
		data.flatCName = flatChannelName

		findUsernameAndEmail(hashedInviteePublicKey, flatTeamName, hashedInviteePublicKey, function(username){
			data.username = username

			var channelRepoPath = getClonedRepoPath(flatChannelName, hashedInviteePublicKey)
			stencil.syncRepo(channelRepoPath, function() {
				getMessageLogContent(channelRepoPath, hashedInviteePublicKey, function(messageLogContent) {
					data.msgs = replaceHashedPublicKeyWithUserName(messageLogContent, hashedInviteePublicKey, flatChannelName)
					sendPages(res, data, '/homepage/channels/renderChannel')
				})
			})
		})
	})
})

app.get('/acceptInvitationToTeam', function(req, res) {
	var flatTeamName = req.query.team
	var invitationID = req.query.invitationID
	var inviteeEmail = req.query.inviteeEmail
	var encodedPublicKey = req.query.encodedPublicKey
	var dataCompleted = req.query.dataCompleted

	var data = {}

	if (dataCompleted == undefined) {

		data.flatTeamName = flatTeamName
		data.invitationID = invitationID
		data.inviteeEmail = inviteeEmail
		data.encodedPublicKey = encodedPublicKey

		sendPages(res, data, 'joinTeam')

	} else {
		var username = req.query.username

		var done = false
		var inviteePublicKey
		var inviteePrivateKey

		//This is based on two assumptions: 
		//first, we store public key in the email-public.pem 
		//for testing multiple users on the same machine
		//Second, users don't migrate between different machines,
		//so users' public key must be in that fixed place, if user has an account
		if (!fs.existsSync(inviteeEmail + '-public.pem')) {
			createUser(inviteeEmail, function(pubKey, priKey) {
				inviteePublicKey = pubKey
				done = true
			})
		} else {
			inviteePublicKey = getPublicKey(inviteeEmail)
			done = true
		}
		deasync.loopWhile(function(){return !done})

		var hashedInviteePublicKey = calculateHash(inviteePublicKey)

		acceptInvitation(hashedInviteePublicKey, encodedPublicKey, username, flatTeamName, invitationID, flatTeamName, inviteeEmail, function(readableTeamName){
			var data1 = {}
			data1.readableTeamName = readableTeamName
			data1.flatTeamName = flatTeamName 
			data1.username = username
			data1.hashedPublicKey = hashedInviteePublicKey

			sendPages(res, data1, '/homepage/channels/getChannels')
		})
	}
})

function getTeamOrChannelInfoOnDHT(teamNameOrChannelName, publicKey, callback) {
	stencil.getValueFromDHT(localDHTNode, DHTSeed, teamNameOrChannelName, function(metaOnDHT) {
		var result = verifyValue(publicKey, metaOnDHT)
		if (result) {
			callback(null, metaOnDHT)
		} else {
			var err = 'ERROR: TAMPERED_GROUPMETA'
			callback(err, null)
		}
	})
}

function acceptInvitation(hashedInviteePublicKey, encodedPublicKey, username, flatTeamNameOrChannelName, invitationID, flatTeamName, inviteeEmail, callback) {
	var publicKey = decodeURIComponent(encodedPublicKey)
	var data = {}

	getTeamOrChannelInfoOnDHT(flatTeamNameOrChannelName, publicKey, function(err, metaOnDHT) {
		if (err != null) {
			res.end(err)
		} else {
			//For now I only find one creator or moderator to allow the new user to join
			//But actually, it should be some or all moderators and creator
			var members = metaOnDHT.members
			var moderatorHashedPublicKey = members[0].hashedPublicKey
			var moderatorAddr = members[0].address

			reqToJoin(username, flatTeamNameOrChannelName, moderatorHashedPublicKey, moderatorAddr, invitationID, hashedInviteePublicKey, flatTeamName, inviteeEmail, function (err) {
				if (err != null) {
					res.end(err)
				} else {
					var teamRepoPath = getClonedRepoPath(flatTeamName, hashedInviteePublicKey)
					var teamMetaFilePath = getFilePathInRepo(teamRepoPath, teamMetaFile)
					var teamMeta = JSON.parse(stencil.getFileFromRepo(teamMetaFilePath))

					callback(teamMeta.name)
				}
			})	
		}
	})
}

function reqToJoin(username, flatName, moderatorHashedPublicKey, moderatorAddr, invitationID, hashedInviteePublicKey, flatTeamName, inviteeEmail, callback) {
	var url = 'http://' + moderatorAddr + ':' + httpListeningPort + '/processAndResToJoinReq'

	if (!fs.existsSync(SSHKeysDir) || !fs.existsSync(SSHPkFilePath)) {
		console.log('Please use command \'ssh-keygen -t rsa -C "your_email@example.com"\' to generate ssh key pairs')
	}

	var SSHPublicKey = fs.readFileSync(SSHPkFilePath)

	var data = {
		username: username,
		SSHPublicKey: SSHPublicKey,
		flatName: flatName,
		invitationID: invitationID,
		moderatorHashedPublicKey: moderatorHashedPublicKey,    //This para is just for testing where mulitple users on the same machine
		hashedInviteePublicKey: hashedInviteePublicKey,
		flatTeamName: flatTeamName, 							//This para is just for joining channel
		inviteeEmail: inviteeEmail  							//This para is just for joining team
	}

	request({
    	url: url, 
    	method: 'POST',
    	form: data
    	//rejectUnauthorized: false,
	    // agentOptions: {
	    // 	cert: fs.readFileSync('client-cert.pem'),
		   //  key: fs.readFileSync('client.pem')
	    // }
	}, function (err, reply, body) {
		if (!err && reply.statusCode == 200) {
			var res = JSON.parse(body)

			//The request might have been processed, so the type might be AlreadyProcessed
			//For now, in order to make it simple, I send request to one creator or moderator
			//so type can only be 'Accept'
			if (res.type == 'Accept') {

				var knownHostKey = res.knownHostKey
				var serverAddr = res.serverAddr

				var serverAddrWithoutUserAccount = getServerAddrWithoutUserAccount(serverAddr)
				stencil.checkAndAddKnownHostKey(serverAddrWithoutUserAccount, knownHostKey)

				var reposFilePath = getFilePathInUserIDDir(hashedInviteePublicKey, reposFile)
				if (res.generalChannel != undefined) {
					var generalChannel = res.generalChannel
					
					addContentToJSONFileLocally(reposFilePath, flatName, function() {

						addContentToJSONFileLocally(reposFilePath, generalChannel, function() {
							cloneRepo(hashedInviteePublicKey, flatName, serverAddr)
							cloneRepo(hashedInviteePublicKey, generalChannel, serverAddr)

							callback(null)
						})

					})

				} else {
					
					addContentToJSONFileLocally(reposFilePath, flatName, function() {
						cloneRepo(hashedInviteePublicKey, flatName, serverAddr)

						callback(null)
					})
					
				}
			}
			else {
				var errMsg = res.type
				callback(errMsg)
			}
		
		} 

		//The moderator might not be online
		else if (err != null) {
			callback(err)
		}
	})
}

function findUsernameAndEmailFromMemList(memList, hashedInviteePublicKey, callback) {
	var username = undefined
	var email = undefined
	for (var i in memList) {
		if (memList[i].hashedPublicKey == hashedInviteePublicKey) {
			username = memList[i].username
			email = memList[i].email
		}
	}
	callback(username, email)
}

function findUsernameAndEmail(userID, flatTeamName, hashedPublicKeyToBeCompared, callback) {
	var repoPath = getClonedRepoPath(flatTeamName, userID)
	var memListFilePath = getFilePathInRepo(repoPath, memListFile)
	var memList = JSON.parse(stencil.getFileFromRepo(memListFilePath))

	findUsernameAndEmailFromMemList(memList, hashedPublicKeyToBeCompared, function(username, email){
		callback(username, email)
	})
}

function processJoinChannelReq(hashedInviteePublicKey, SSHPublicKey, flatChannelName, moderatorHashedPublicKey, flatTeamName, callback) {	
	findUsernameAndEmail(moderatorHashedPublicKey, flatTeamName, hashedInviteePublicKey, function(username, email) {
		var newMem = {}
		newMem.username = username
		newMem.hashedPublicKey = hashedInviteePublicKey
		newMem.email = email

		addMember(flatChannelName, moderatorHashedPublicKey, newMem, SSHPublicKey, hashedInviteePublicKey, function(serverAddr, knownHostKey) {
			
			callback(null, serverAddr, knownHostKey)
		})
		
	})
}

function appendToMemList(teamNameOrChannelName, userID, newMem, callback) {
	var repoPath = getClonedRepoPath(teamNameOrChannelName, userID)
	var memListFilePath = getFilePathInRepo(repoPath, memListFile)
	var content = stencil.getFileFromRepo(memListFilePath)

	if (content == undefined) {
		var members = []
		members.push(newMem)
		stencil.createOrUpdateFileInRepo(memListFilePath, JSON.stringify(members), 'create', function() {
			callback()
		})
	} else {
		var members = JSON.parse(content)
		members.push(newMem)
		stencil.createOrUpdateFileInRepo(memListFilePath, JSON.stringify(members), 'update', function() {
			callback()
		})
	}

}

function getServerAddrWithoutUserAccount(serverAddr) {
	return serverAddr.split('@')[1]
}

function addMember(name, moderatorHashedPublicKey, newMem, SSHPublicKey, newMemHashedPublicKey, callback) {
	appendToMemList(name, moderatorHashedPublicKey, newMem, function() {
		var repoPath = getClonedRepoPath(name, moderatorHashedPublicKey)
		var serverAddr = stencil.getServerAddr(repoPath)

		var adminRepoDir = getAdminReposDir(moderatorHashedPublicKey, serverAddr)
		var repoName = getRepoNameFromTeamOrChannelName(name)
		stencil.addKeyAndUpdateConfigFileInAdminRepo(adminRepoDir, SSHPublicKey, newMemHashedPublicKey, repoName)
		
		var serverAddrWithoutUserAccount = getServerAddrWithoutUserAccount(serverAddr)
		var knownHostKey = stencil.getKnownHostKey(serverAddrWithoutUserAccount)

		callback(serverAddr, knownHostKey)
	})
}

function processJoinTeamReq(username, hashedInviteePublicKey, SSHPublicKey, flatTeamName, moderatorHashedPublicKey, inviteeEmail, callback) {
	var newMem = {}
	newMem.username = username
	newMem.hashedPublicKey = hashedInviteePublicKey
	newMem.email = inviteeEmail
	newMem.role = []
	newMem.role.push('normal')

	addMember(flatTeamName, moderatorHashedPublicKey, newMem, SSHPublicKey, hashedInviteePublicKey, function() {
		var generalChannelFlatName		
		findChannelsUserIn(moderatorHashedPublicKey, flatTeamName, function(channelsUserIn) {

			for (var i in channelsUserIn) {
				if (channelsUserIn[i].readableName == 'general') {
					generalChannelFlatName = channelsUserIn[i].flatName
					break
				}
			}
			addMember(generalChannelFlatName, moderatorHashedPublicKey, newMem, SSHPublicKey, hashedInviteePublicKey, function(serverAddr, knownHostKey) {

				callback(null, serverAddr, knownHostKey, generalChannelFlatName)

			})
		})
	})
}

app.post('/processAndResToJoinReq', function(req, res) {
	var username = req.body.username
	var SSHPublicKey = req.body.SSHPublicKey
	var flatName = req.body.flatName
	var invitationID = req.body.invitationID
	var moderatorHashedPublicKey = req.body.moderatorHashedPublicKey
	var hashedInviteePublicKey = req.body.hashedInviteePublicKey
	var flatTeamName = req.body.flatTeamName
	var inviteeEmail = req.body.inviteeEmail

	//Actually, moderatorHashedPublicKey is not needed, because the moderator can calculate
	//from its public key. But as I test multiple users on the same machine, I need it for now
	var repoPath = getClonedRepoPath(flatName, moderatorHashedPublicKey)
	var invitationMetaFilePath = getFilePathInRepo(repoPath, invitationMetaFile)
	var fileContent = JSON.parse(stencil.getFileFromRepo(invitationMetaFilePath))

	var found = false
	for (var i in fileContent) {
		if (fileContent[i].invitationID == invitationID && fileContent[i].status == 'pending') {
			fileContent[i].joinTeamTs = new Date()
			fileContent[i].hashedInviteePublicKey = hashedInviteePublicKey
			fileContent[i].status = 'accepted'
			found = true
			break
		}
	}
	if (found) {

		stencil.createOrUpdateFileInRepo(invitationMetaFilePath, JSON.stringify(fileContent), 'update', function() {

			if (username != undefined) {
				processJoinTeamReq(username, hashedInviteePublicKey, SSHPublicKey, flatName, moderatorHashedPublicKey, inviteeEmail, function(err, serverAddr, knownHostKey, generalChannelFlatName) {
					if (err != null) {
						res.end(err)
					} else {
						var response = {}
						response.type = 'Accept'
						response.generalChannel = generalChannelFlatName
						response.knownHostKey = knownHostKey
						response.serverAddr = serverAddr
						res.write(JSON.stringify(response))
						
						res.end()
					}
				})
			} else {
				processJoinChannelReq(hashedInviteePublicKey, SSHPublicKey, flatName, moderatorHashedPublicKey, flatTeamName, function(err, serverAddr, knownHostKey, channelType) {
					
					if (err != null) {
						res.end(err)
					} else {
						var response = {}
						response.type = 'Accept'
						response.knownHostKey = knownHostKey
						response.serverAddr = serverAddr
						res.write(JSON.stringify(response))
						res.end()
					}
				})
			}

		})
	} else {

		var response = {}
		response.type = 'No Such Invitation or the Invitation Has been resolved'
		res.write(JSON.stringify(response))
		res.end()

	}
})

function difference(allTeamPublicChannels, allChannelsAndTeams) {
	var publicChannelsUserNotIn = []
	for (var i in allTeamPublicChannels) {
		var find = false
		for (var j in allChannelsAndTeams) {
			if (allTeamPublicChannels[i].flatName == allChannelsAndTeams[j]) {
				find = true
			}
		}
		if (!find) {
			publicChannelsUserNotIn.push(allTeamPublicChannels[i])
		} 
	}
	return publicChannelsUserNotIn
} 

function findPublicChannelsUserNotIn(userID, flatTeamName, callback) {
	var resultChannels = []

	var reposFilePath = getFilePathInUserIDDir(userID, reposFile)
	getJSONFileContentLocally(reposFilePath, function(allChannelsAndTeams) {
		var teamRepoPath = getClonedRepoPath(flatTeamName, userID)
		var publicChannelsFilePath = getFilePathInRepo(teamRepoPath, publicChannelsFile)

		var allTeamPublicChannels = JSON.parse(stencil.getFileFromRepo(publicChannelsFilePath))
		var publicChannelsUserNotIn = difference(allTeamPublicChannels, allChannelsAndTeams)

		for (var i in publicChannelsUserNotIn) {
			var channelMeta = {}
			channelMeta.flatName = publicChannelsUserNotIn[i].flatName
			channelMeta.readableName = publicChannelsUserNotIn[i].readableName
			channelMeta.status = 'out'
			channelMeta.type = 'public'
			resultChannels.push(channelMeta)

		}
		callback(resultChannels)

	})

}

function findAllChannels(userID, flatTeamName, callback) {
	findChannelsUserIn(userID, flatTeamName, function(channelsUserIn) {		
		findPublicChannelsUserNotIn(userID, flatTeamName, function(publicChannelsUserNotIn) {
			callback(_.union(channelsUserIn, publicChannelsUserNotIn))
		})
	})
}

function intersection(allGroupsUserIn, allTeamPublicChannels) {
	var publicChannelsUserIn = []
	for (var i in allTeamPublicChannels) {
		for (var j in allGroupsUserIn) {
			if (allTeamPublicChannels[i].flatName == allGroupsUserIn[j]) {
				var channel = {}
				channel.readableName = allTeamPublicChannels[i].readableName
				channel.flatName = allTeamPublicChannels[i].flatName
				publicChannelsUserIn.push(channel)
				break
			}
		}
	}
	return publicChannelsUserIn
}

function findChannelsUserIn(userID, flatTeamName, callback) {
	var channelsUserIn = []

	var reposFilePath = getFilePathInUserIDDir(userID, reposFile)

	getJSONFileContentLocally(reposFilePath, function(allChannelsAndTeams) {
		var teamRepoPath = getClonedRepoPath(flatTeamName, userID)
		var publicChannelsFilePath = getFilePathInRepo(teamRepoPath, publicChannelsFile)

		var allTeamPublicChannels = JSON.parse(stencil.getFileFromRepo(publicChannelsFilePath))
		var publicChannelsUserIn = intersection(allChannelsAndTeams, allTeamPublicChannels)

		for (var i in publicChannelsUserIn) {
			var channelMeta = {}
			channelMeta.flatName = publicChannelsUserIn[i].flatName
			channelMeta.readableName = publicChannelsUserIn[i].readableName
			channelMeta.status = 'in'
			channelMeta.type = 'public'
			channelsUserIn.push(channelMeta)
		}

		for (var i in allChannelsAndTeams) {
			var repoPath = getClonedRepoPath(allChannelsAndTeams[i], userID)
			var channelMetaFilePath = getFilePathInRepo(repoPath, channelMetaFile)
			var unprocessedFileContent = stencil.getFileFromRepo(channelMetaFilePath)
			if (unprocessedFileContent == undefined) {
				continue
			}

			var channelMeta = JSON.parse(unprocessedFileContent)
			var privateChannelMeta = {}

			if (channelMeta.teamName == flatTeamName) {
				privateChannelMeta.flatName = allChannelsAndTeams[i]
				privateChannelMeta.readableName = channelMeta.name
				privateChannelMeta.status = 'in'
				privateChannelMeta.type = 'private'
				channelsUserIn.push(privateChannelMeta)
			}
		}

		callback(channelsUserIn)
	})
			
}

//Send a dynamic page back
function sendPages(res, data, type) {
	var homepageTeam = '/homepage/team/'
	var homepageChannels = '/homepage/channels/'

	var hashedPublicKey

	if (data.publicKey != undefined) {
		hashedPublicKey = calculateHash(data.publicKey)
	} else {
		hashedPublicKey = data.hashedPublicKey
	}
	
	if (type.indexOf(homepageChannels) != -1 ) {
		if (type.indexOf('renderChannel') == -1) {
			data.msgs = []
			data.flatCName = 'null'
		}
		if (type.indexOf('browseAllChannels') != -1) {
			res.render('homepage', { username: JSON.stringify(data.username), hashedPublicKey: JSON.stringify(hashedPublicKey), 
									readableTeamName: JSON.stringify(data.readableTeamName), flatTeamName: JSON.stringify(data.flatTeamName),
									channels: JSON.stringify(data.allChannels), page: JSON.stringify(type),
									msgs: JSON.stringify(data.msgs), chosenChannel: JSON.stringify(data.flatCName)
			})
		} else {
			findChannelsUserIn(hashedPublicKey, data.flatTeamName, function(channelsUserIn) {				
				res.render('homepage', { username: JSON.stringify(data.username), hashedPublicKey: JSON.stringify(hashedPublicKey), 
								readableTeamName: JSON.stringify(data.readableTeamName), flatTeamName: JSON.stringify(data.flatTeamName),
								channels: JSON.stringify(channelsUserIn), page: JSON.stringify(type),
								msgs: JSON.stringify(data.msgs), chosenChannel: JSON.stringify(data.flatCName)
				})
			})
		}
	} else if (type.indexOf(homepageTeam) != -1) {
		res.render('homepage', { username: JSON.stringify(data.username), hashedPublicKey: JSON.stringify(hashedPublicKey), 
							readableTeamName: JSON.stringify(data.readableTeamName), flatTeamName: JSON.stringify(data.flatTeamName),
							channels: JSON.stringify([]), page: JSON.stringify(type), msgs: JSON.stringify([]),
							chosenChannel: JSON.stringify('null')
		})
	} else if (type == 'joinTeam') {
		res.render('joinTeam', { flatTeamName: JSON.stringify(data.flatTeamName), invitationID: JSON.stringify(data.invitationID),
								 inviteeEmail: JSON.stringify(data.inviteeEmail),
								 encodedPublicKey: JSON.stringify(data.encodedPublicKey)
		})
	}
}

app.post('/browseAllChannels', function(req, res) {
	var username = req.body.username
	var hashedPublicKey = req.body.hashedPublicKey
	var flatTeamName = req.body.flatTeamName
	var readableTeamName = req.body.readableTeamName

	findAllChannels(hashedPublicKey, flatTeamName, function(allChannels) {
		var data = {}
		data.username = req.body.username
		data.hashedPublicKey = req.body.hashedPublicKey
		data.flatTeamName = req.body.flatTeamName
		data.readableTeamName = req.body.readableTeamName
		data.allChannels = allChannels

		sendPages(res, data, '/homepage/channels/browseAllChannels')
	})
})

// //Deal with select group
// app.post('/selectGroup', function(req, res) {
//     var username = req.body.username
//     var groupName = req.body.groupName
//     sendPages(res, username, groupName, null, null, 'homepage/tags', null)
// })

// //Get group Info
// app.post('/homepage/group/getGroupsInfo', function(req, res) {
// 	var username = req.body.username
// 	var groupName = req.body.groupName
// 	stencil.getUserInfo(username, function (usermeta) {
// 		var groups = JSON.parse(usermeta).groups
// 		if (groups.length == null) {
// 			sendPages(res, username, groupName, null, null, 
// 					'homepage/group/getGroupsInfo', null)
// 		} else {
// 			var groupsMeta = []
// 			var done
// 			for (var i = 0; i < groups.length; i++) {
// 				done = false
// 				stencil.getGroupInfo(groups[i].groupName, function (groupMeta) {
// 					groupsMeta[i] = {}
// 					groupsMeta[i].name = groups[i].groupName
// 					groupsMeta[i].description = JSON.parse(groupMeta).description
// 					done = true
// 				})
// 				deasync.loopWhile(function(){return !done})
// 			}
// 			sendPages(res, username, groupName, null, null, 
// 						'homepage/group/getGroupsInfo', groupsMeta)
// 		}
		
// 	})
// })

// //Leave one Group
// app.post('/homepage/group/leaveOneGroup', function(req, res) {
// 	var username = req.body.username
// 	var currentGroupName = req.body.currentGroupName
// 	var leaveGroupName = req.body.leaveGroupName
// 	var leaveGroup = true
// 	stencil.getGroupInfo(leaveGroupName, function (groupMeta) {
// 		if (groupMeta == undefined) {
// 			leaveGroup = false
// 			sendPages(res, username, currentGroupName, null, null, 
// 				'homepage/group/leaveOneGroup/GroupNotExisted')
// 		}
// 		if (leaveGroup) {
// 			stencil.getUserInfo(username, function (usermeta) {
// 				var groups = JSON.parse(usermeta).groups
// 				var inGroup = false
// 				for (var i = 0; i < groups.length; i++) {
// 					if (leaveGroupName == groups[i].groupName) {
// 						inGroup = true
// 						break
// 					}
// 				}
// 				if (inGroup) {
// 					stencil.leaveGroup(username, leaveGroupName, function () {
// 						if (leaveGroupName == currentGroupName) {
// 							groupName = null
// 						} else {
// 							groupName = currentGroupName
// 						}
// 						sendPages(res, username, groupName, null, null, 
// 							'homepage/group/leaveOneGroup/LeaveGroupSuccessfully')
// 					})
// 				} else {
// 					sendPages(res, username, currentGroupName, null, null, 
// 						'homepage/group/leaveOneGroup/NotInGroup')
// 				}
// 			})
// 		}
// 	})
// })

// //Change current group
// app.post('/homepage/group/changeCurrentGroup', function(req, res){
// 	var currentGroupName = req.body.currentGroupName
// 	var username = req.body.username
// 	var selected_groupName = req.body.selected_groupName
// 	if (selected_groupName == currentGroupName) {
// 		sendPages(res, username, currentGroupName, null, null, 
// 				'homepage/group/changeCurrentGroup/NoNeedToChange')
// 	} else {
// 		sendPages(res, username, selected_groupName, null, null, 
// 				'homepage/group/changeCurrentGroup/ChangeGroupSuccessfully')
// 	}
// })

var httpServer = http.createServer(app)

stencil.createDHTNode(localDHTNodeAddr, localDHTNodePort, localDHTNodeDB, function(node) {
	localDHTNode = node
	httpServer.listen(httpListeningPort)
})

console.log('App is listening at port %d', httpListeningPort)
