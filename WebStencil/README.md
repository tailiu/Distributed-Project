WebStencil is a distributed storage system that is intended to be used in the web browser

#Installation
```
npm install WebStencil --save
```

#API

###DHT
```
createDHTNode(nodeAddr, nodePort, db, callback)
putValueOnDHT(DHTNode, DHTSeed, key, value, callback)
getValueFromDHT(DHTNode, DHTSeed, key, callback)
```

###Torrent
```
createTorrentClient()
getFileFromTorrent(torrentSeeds, downloadedFilePath, client, callback)
createFileInTorrent(filePath, client, callback)
```

###Git
#####Repo Related
```
createRepo(adminRepoDir, repoName, addedkeyName, host)
cloneRepo(remoteRepoLocation, localRepoDir, host, keyName, branch)
getFileFromRepo(filePath, host, view)
writeFileToRepo(filePath, content, option, host, branch, callback)
addKeyToRepo(adminRepoDir, SSHPublicKey, keyName, repoName, host)
```

#####Branch Related
```
createBranch(repoPath, branchName, callback)
changeBranch(repoPath, branchName, callback)
mergeBranch(repoPath, branchName, callback)
syncBranch(repoPath, host, branch, callback)
getBranchNames(repoPath)
getCurrentBranchName(repoPath)
```

###Key
```
getKnownHostKey(serverAddrWithoutUserAccount)
checkAndAddKnownHostKey(serverAddrWithoutUserAccount, knownHostsKey)
```