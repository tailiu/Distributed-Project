const stencil = require('WebStencil')
const fs = require('graceful-fs')
const crypto = require('crypto')
const mkdirp = require('mkdirp')
const lineByLine = require('n-readlines') 
const lockfile = require('proper-lockfile') 
const _ = require('underscore')

const clonedReposDir = 'cloned_repos'
const downloadedFilesDir = 'downloaded_files'
const postsMetaFile = 'posts_meta'
const postsFile = 'posts'
const dataBranch = 'master'
const dataStructureBranch = 'data_structure'
const uploadedFilesDir = 'uploaded_files'
const branchLocksDir = 'branch_locks'
const rulesFile = 'rules'
const dirLock = 'dir_lock'

function getClonedReposDir(userID, ok) {
	return userID + '/' + clonedReposDir
}

function getFilePathInRepo(repoPath, relativeFilePathInRepo) {
	return repoPath + '/' + relativeFilePathInRepo
}

function getHost(userID, groupName) {
	return userID + '-' + groupName
}

function getDownloadedFilePath(userID, fileName, classID) {
	return userID + '/' + downloadedFilesDir + '/' + classID + '/' + fileName
}

function getDownloadedFileName(branch, fileName) {
	return branch + ':' + fileName
}

function getUploadedFilesDir(userID) {
	return userID + '/' + uploadedFilesDir
}

function getClonedRepoPath(groupName, userID) {
	var clonedRepoDir = getClonedReposDir(userID)
	return clonedRepoDir + '/' + groupName
}

function createTmpFile(fileDir, content, callback) {
	crypto.randomBytes(32, function(err, buf) {
		var fileName = buf.toString('hex')

		if (!fs.existsSync(fileDir)) {
			mkdirp.sync(fileDir)
		} 
		filePath = fileDir + '/' + fileName
		fs.writeFile(filePath, content, function(err) {
			callback(filePath)
		})
	})
}

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

function lock(filePath, callback) {
	var backoffTime = _.random(0, 5000)

	lockfile.lock(filePath, function(err, release) {
		if (err) {
			console.log(process.pid + ' failed to lock ' + filePath + ' ' + err.toString())
			setTimeout(function(){
	    		lock(filePath, callback)
	    	}, backoffTime)
		} else {
			console.log(process.pid + ' locks ' + filePath)
			callback(release)
		}
	})
}

function getFileNameFromFilePath(path) {
	var parts = path.split('/')
	var fileName = parts[parts.length - 1]
	return fileName
}

function getFileDirFromFilePath(path, fileName) {
	return path.replace(fileName, '')
}

//master view name
exports.dataBranch = dataBranch

exports.postsMetaFile = postsMetaFile

exports.dataStructureBranch = dataStructureBranch

exports.getRulesFilePath = function(userID, groupName) {
	var clonedRepoPath = getClonedRepoPath(groupName, userID)
	return clonedRepoPath + '/' + rulesFile
}

exports.getHost = function(userID, groupName) {
	return getHost(userID, groupName)
}

exports.getClonedReposDir = function(userID) {
	return getClonedReposDir(userID)
}

exports.getFilePathInRepo = function(repoPath, relativeFilePathInRepo) {
	return getFilePathInRepo(repoPath, relativeFilePathInRepo)
}

exports.getBranchLockFilePath = function(userID, classID) {
	return userID + '/' + branchLocksDir + '/' + classID
}

exports.getClonedRepoPath = function(groupName, userID) {
	return getClonedRepoPath(groupName, userID)
}

exports.getDownloadedFileName = function(branch, fileName) {
	return getDownloadedFileName(branch, fileName)
}

exports.getDownloadedFilePath = function(userID, fileName, classID) {
	return getDownloadedFilePath(userID, fileName, classID)
}

exports.getJSONFileContentLocally = function(filePath, callback) {
	getJSONFileContentLocally(filePath, callback)
}

// exports.downloadPosts = function(groupName, userID, view, downloadClient, callback) {
// 	var repoPath = getClonedRepoPath(groupName, userID)
// 	var postsMetaFilePath = getFilePathInRepo(repoPath, postsMetaFile)

// 	getJSONFileContentLocally(postsMetaFilePath, function(postsMetaContent) {
// 		var postsFileName = getDownloadedPostsFileName(groupName, view)
// 		var postsFilePath = getDownloadedFilePath(userID, postsFileName)
// 		stencil.getFileFromTorrent(postsMetaContent.seeds, postsFilePath, downloadClient, function() {

// 			getJSONFileContentLocally(postsFilePath, function(posts) {
// 				callback(posts)
// 			})
// 		})
// 	})
// }

exports.keepNewCommitAndRemoveOldOne = function(filePath, callback) {
	var liner = new lineByLine(filePath)

	var line
	var content = ''
	var find = false

	while (line = liner.next()) {
		var str = line.toString('ascii')
		str = str.trim()
		if (str.indexOf('<<<<<<< HEAD') != -1 ) {
			find = true
			continue
		} else if (str.indexOf('=======') != -1 ) {
			find = false
			continue
		} else if (str.indexOf('>>>>>>>') != -1 ) {
			break 
		}
		if (!find) {
			content += str + '\n'
		}
	}

	fs.writeFile(filePath, content, function(err) {
		callback()
	})
}

exports.createOrUpdateFile = function(classID, userID, content, option, branch, seedClient, fileName, callback) {
	var fileDir = getUploadedFilesDir(userID)
	var host = getHost(userID, classID)
	var repoPath = getClonedRepoPath(classID, userID)

	createTmpFile(fileDir, JSON.stringify(content), function(filePath) {
		stencil.createFileInTorrent(filePath, seedClient, function(fileMeta) {
			var FilePath = getFilePathInRepo(repoPath, fileName)
			stencil.writeFileToRepo(FilePath, JSON.stringify(fileMeta), option, host, branch, function(err) {
				callback(err)
			})
		})
	})
}

exports.lock = function(filePath, callback) {
	lock(filePath, callback)
}

exports.createJSONFileLocally = function(filePath, content, callback) {
	var fileName = getFileNameFromFilePath(filePath)
	var fileDir = getFileDirFromFilePath(filePath, fileName)

	mkdirp.sync(fileDir)

	fs.writeFile(filePath, JSON.stringify(content), function(err){
		callback()
	})
}

exports.filterPosts = function(posts, filterKeyWords) {
	var removeValFromIndex = []
	for (var i in posts) {
		if (posts[i].title.indexOf(filterKeyWords) != -1 || posts[i].pContent.indexOf(filterKeyWords) != -1) {
			removeValFromIndex.push(i)
		}
	}
	for (var i = removeValFromIndex.length - 1; i >= 0; i--) {
		posts.splice(removeValFromIndex[i], 1)
	}
	return posts
}

exports.createRandom = function() {
	var current_date = (new Date()).valueOf().toString()
	var random = Math.random().toString()
	return crypto.createHash('sha1').update(current_date + random).digest('hex')
}

exports.getDownloadedFilesDirLockPath = function(userID, classID) {
	return userID + '/' + downloadedFilesDir + '/' + classID + '/' + dirLock
}

exports.getUserDataFileName = function(userID) {
	return userID + '_data'
}