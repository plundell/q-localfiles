#!/usr/local/bin/node
'use strict';

/*
* @module LocalFiles
* @author plundell <qmusicplayer@protonmail.com>
* @license Apache-2.0
* @description Plays files on the local filesystem. URIs should be prepended by "file:"
* @depends libbetter
* @exports function   Exports an "exporter function" which should be called with the 
*                     dependencies to get the @contents.
* @contents function  Constructor for LocalFiles object 
*
* @todo	2018-10-23 Streams create many small Buffers, which the Garbage Collector needs to deal with, but 
*                  usually this takes time and RAM builds... using a single Buffer the size of the entire
*                  file (possible here becase we know file size) is MUCH more RAM friendly:
*                    https://github.com/nodejs/node/issues/6078
*/
module.exports = function exportLocalFiles(scope,settings){

    const BetterLog=scope.BetterLog
    const BetterEvents=scope.BetterEvents
    const cX=scope.BetterUtil.cX
    const fsX=scope.BetterUtil.fsX 
    const ffprobe=scope.api.apps['q-ffprobe'].ffprobe



	const log=new BetterLog('LocalFiles');	






	const root={
		uri:'file:/'
		,type:'folder'
		,title:'Local'
		,libraryPath:'/'
		,contents:[]
	}


	/*
	* @param string x 			The path or uri
	* 
	* @throws <ble TypeError> 	if $x not string
	*
	* @return string 			A normalized path to a file without any prefix
	*/
	function toPath(x){			

		var path=cX.trim(x,true) //true==if not non-empty string, throw error

		//Remove the leading part of a uri and decode the rest
		if(path.substring(0,6)=='file:/'){
			path=decodeURIComponent(path.substring(5));
		}

		//Resolve the path so it's clean for storage
		path=fsX.path.normalize(path);

		return path;
	}


	/*
	* @param string x 			The path or uri
	* 
	* @throws <ble TypeError> 	if $x not string
	*
	* @return string 			A prefixed uri
	*/
	function toUri(x){
		var uri=cX.trim(x,true) //true==if not non-empty string, throw error

		//Prepend uriPrefix and encode the path
		if(uri.substring(0,6)!='file:/'){
			uri='file:'+encodeURIComponent(uri);
		}		

		return uri;	
	}




	/*
	* Check if LocalFiles can play a uri
	*
	* @param string uri 	
	*
	* @throws <ble TypeError>
	* @throws <ble EFAULT> 		If the uri points to a file, but that file doesn't exist
	*
	* @return Promise(bool)	If the uri is supported, the filepath is returned, else false
	*/
	async function canPlayUri(uri){
		try{
			uri=cX.trim(uri,true); //typeerror if not string

			if(uri.substring(0,6)!='file:/'){
				//Just to be sure, if it starts with a '/', check if we got a regular path... without throwing on fail
				if(uri.substr(0,1)=='/' && fsX.exists(uri,'file'))
					return true
				return false
			}
			
			fsX.exists(toPath(uri),'file','ENOTFOUND'); //throw if it doesn't exist
			return true;

		}catch(err){
			err=log.makeError(err);

			if(err.code=='TypeError')
				return err.reject();
			else
				return err.somewhere(uri).setCode('EFAULT').reject();
		}
	}




	/**
	* Get information about a local uri
	*
	* @param string uri 	Uri or path works. Cannot point to a folder
	*
	* @return Promise(<TrackObj>,err)	 Rejects if the file doesn't exist, or the file format is not supported
	*/
	async function getUriDetails(uri){		
		try{
			let path=toPath(uri);
			if(path=='/'){
				return {
					uri:'file:/'
					,type:'folder'
					,title:'Local'
					,libraryPath:'/'
					,contents:[]
				}
			}
			var details=await ffprobe(path);
			details.contents=path;
			details.uri=toUri(path);
			return details;
		}catch(err){
			return log.makeError(err).addHandling('call canPlayUri() before getUriDetails()').setCode('ESEQ').reject();
		}
	}




	



	/*
	* Play a file on the local filesystem as a wav stream
	*
	* @param object track 	@see this.getUriDetails(); 	
	*
	* @return string 	Path to file on filesystem 
	* @export
	*/
	function getStream(track){
		if(!track || typeof track !='object' || track.type!='track')
			log.throwType("track object",track);

		try{
			//Just make sure to get a valid path (else errors seem to take a while to track down... has happened twice now...)
			fsX.exists(track.contents,'file','throw');

			return track.contents;
		}catch(err){
			return log.makeError(err).addHandling('call getUriDetails() before getStream()').setCode('ESEQ').reject();
		}
	}	































	/*
	* Get an object with all uri's known to this player
	*
	* @return array|<SmartArray> 	If no settings.libraryPaths have been specified, then an empty array, else a 
	*								SmartArray that will be appended with all uri's we find, including when new 
	*								uri's are found at a later time (eg. if we connect a USB drive)
	*/
	var uriList;
	function getUriList(){
		if(uriList)
			return uriList

		if(settings.paths && settings.paths.length){
			uriList=scanForFiles.call(this, settings.paths,settings.includeVideo); //call.this => for logging
			return uriList;
		}else{
			log.note("No settings.libraryPaths specified, no local files will be added");
			return []
		}
	}




	/*
	* Scan one or more locations for audio files supported by ffmpegPopulate an array with all audio files in the settings.paths and add them to uriList. 
	* 
	* NOTE: log will be used if available, else log
	*
	* @param array locations			Array of string paths to search
	* @param boolean includeVideo 		If true, video files with audio tracks will be included
	*
	* @throw <ble TypeError>
	* @return <SmartArray> 		A smart array that get's appended with each supported file it finds
	*/
	function scanForFiles(locations,includeVideo=false){
		log.info(`Scanning for files in ${locations.length} locations:`,locations)
		var uriList=new smart.Array();
		settings.paths.forEach(root=>{
			//Fire async checks of each root dir...
			fsX.find(root,{type:'f',log:log,callback:
				function addAudioFile(path){
					try{
						//Get rid of anythin we KNOW not to be audio... (faster then checking support for each file)
						if(isNotAudio(path)) 
							return; 

						//Then check if the file is supported...
						path=isSupported(path);
						if(path)
							uriList.push('file:'+path); //...if so, add it to the list

						return path; //return so the logs show the right number of files...
					}catch(err){
						log.makeError(err).addHandling('root:',root).addHandling('file:',path).exec();
					}
				}
			}).catch(function find_failed(err){log.error('Failed to scan library path:',root,err)})
		});

		//...but return the SmartArray right away...
		return uriList;
	}


	/*
	* Check if a filepath has a known audio (or video, @see $includeVideo) extension
	*
	* @param string path
	* @param boolean includeVideo
	*
	* @return boolean 	true=>definately not audio
	* @call(<LocalPlayer>)
	*/
	function isNotAudio(path){
		let ext=fsX.path.extname(path);
		if(!ext)
			return false; //could be anything, incl. audio
		let types=fsX.fileExtType(ext);
		if(!types)
			return false; //unknown filetype... could be audio
		else if(types.includes('audio'))
			return false; //it IS AUDIO
		else if(settings.includeVideo && types.includes('video'))
			return false; //it is video, but we're calling that audio
		else
			return true;
	}













	return {getUriDetails,getUriList,canPlayUri,getStream};

} //end of LocalFiles








	// function getInfo_soxi(path){
	// 	return new Promise(async (resolve,reject)=>{try{
	// 		//Define a function we can call repeatedly that uses a cli command to evaluate the file (if it's playable),
	// 		//and returns an object of details about the file or throws an error
	// 		function getInfo(flag, type='number'){
	// 			return cpX.execFileInPromise('soxi',[flag, path], {timeout:100, encoding:'utf8'})
	// 				.then(
	// 					function success(obj){
	// 						let str = obj.stdout.replace(/\n$/,''); //remove trailing newline 
	// 						return (type=='number' ? parseInt(str) : str);
	// 					}
	// 					,function error(obj){
	// 						//If the command failed the error should contain the stderr output of it, in which case just grab the 
	// 						//stderr and re-throw that, else print the entire error and throw a generic message.
	// 						var msg = obj.stderr; 
	// 						if(msg===undefined){
	// 							log.error(obj);
	// 							msg ="Unknown error getting file info '"+flag+"' for "+path;
	// 						}
	// 						return Promise.reject(msg);
	// 					}
	// 				)
	// 			;
	// 		}

	// 		//Run ^^ command repeatedly, populating the info object before returning it
	// 		info.format = await getInfo('-t','string'); //await the first one, so it can fail on bad file before we trigger the others
	// 		info.codec = await getInfo('-e','string'); //TODO: the rest can all be fired at once...
	// 		info.sampleRate = await getInfo('-r');
	// 		info.bitDepth = await getInfo('-b');
	// 		info.channels = await getInfo('-c');
	// 		info.duration = await getInfo('-D');

	// 		//Attempt to parse any info from "comments"
	// 		try{
	// 			var commentStr=await getInfo('-a','string');
	// 			var obj=cX.keysToLower(cX.strToObj(commentStr));
	// 			info.title=obj.title||obj.name||null;
	// 			info.album=obj.album||null;
	// 			info.artist=obj.artist || obj.albumartist || obj.composer||null;
	// 			info.year=obj.year || obj.date || null;
	// 			info.genre=obj.genre || null;
	// 		}catch(err){
	// 			log.error('Failed to parse track comments for info',err)
	// 		}
	// 			// log.info("File info: ",info);
	// 		return resolve(info);
	// 	}catch(err){return reject(err);}});
	// }




	// /*
	// * @func scanLibrary			Scan this.options.libraryPaths for any playable files
	// *
	// * @param func storeCallback 		Each found playable file will be passed to getFileInfo() and the resulting promise 
	// *										passed to this callback
	// * @param func *includeFilter 		Optional. Filter function that returns true if the file should be included.
	// * 
	// * @return <BetterEvents> 	Emits 3 events:
	// *								'progress'(number) 		Integer between 0-100, percentage done
	// *								'msg'(string, string) 	First string can be 'verbose', 'info', 'note','error'. Second is the message
	// *								'done'(bool,string) 	First arg is success, second is end status/ouctcome
	// * @async
	// * @access public
	// */
	// this.scanLibrary=function(storeCallback,includeFilter){
	// 	log.traceFunc(arguments);

	// 	//Create an event emitter we can return
	// 	var ee=new BetterEvents();

	// 	var l=log;
	// 	function scanLibrary_log(lvl,msg,...extra){ //named this way so log shows good things
	// 		let ble=new global.class.BetterLogEntry(lvl,msg,extra,l).changeWhere(1).exec();
	// 		lvl=(ble.lvl<3 ? 'verbose':lvl);
	// 		ee.emit(lvl,msg);
	// 	}

	// 	//Then trigger a timeout to fire in 1ms
	// 	var self=this;
	// 	setTimeout(async function _scanLibrary(){
	// 		try{

	// 			//First get a list of files from each location
	// 			let locations=self.options.get('libraryPaths')
	// 			let l=locations.length
	// 			if(l>1)

	// 				scanLibrary_log('info',`LocalFiles is going to scan ${locations.length} locations...`);
	// 			else
	// 				scanLibrary_log('info',`LocalFiles is going to scan ${locations[0]}...`);

	// 			var i,allFiles=[];
	// 			for(i in locations){
	// 				try{
	// 					let root=locations[i];
	// 					if(l>1)
	// 						scanLibrary_log('info',`Scanning: ${root} ...`);
						
	// 					//Scan the path for files using linux 'find', getting a single newline-delimited strings of files under this 'root'
	// 					var {stdout}=await cpX.execFileInPromise('find',[root,'-type','f']); //get 
						
	// 					//Split ^^ into array of filepath strings	
	// 					var files=stdout.split('/n').reduce((pathsArr,str)=>pathsArr.concat( //3. Merge into pathsArray
	// 								str.split('\n').filter(path=>path!='')//2. Split strings into arrays (and discard trailing empty)
	// 							)
	// 							,[] //1. start with empty array, soon to contain paths
	// 						)

	// 					let before=files.length
	// 					if(!before){
	// 						if(l>1)
	// 							scanLibrary_log('info',`No files found in that location.`);
	// 					}else{
	// 						if(l>1)
	// 							scanLibrary_log('info',`Found ${before} files...`);
	// 						allFiles=allFiles.concat(files);
	// 					}

	// 				} catch(err){
	// 					scanLibrary_log('error',`Failed to scan ${root}`,err);
	// 				}
	// 			}

	// 			if(!allFiles.length){
	// 				ee.emit('done',false,"No files found"); //false==this is a failure
	// 				l.note("Scanning done, no files found");
	// 				return;
	// 			}


	// 			//Now handle each file, emitting 'progress' and 'verbose' as we go
	// 			let total=allFiles.length;
	// 			scanLibrary_log("info",`Found a total of ${total} files in all folders. Processing...`);
	// 			var added=0,updated=0,failed=[],progress=0;
	// 			ee.emit("progress",progress);
	// 			var path,skipReason;
	// 			for(i in allFiles){
	// 				let path=allFiles[i];
	// 				let ext=fsX.path.extname(path);
	// 				let types=fsX.fileExtType(ext);
					
	// 				//Ignore files that don't have an extension or has a known extension of another type
	// 				if(!ext || (types && !types.includes('audio') && !types.includes('video'))){
	// 					scanLibrary_log("trace",`Not an audio file, skipping: ${path}`);
	// 				}else if(includeFilter && (skipReason=includeFilter(path))){
	// 					scanLibrary_log("trace",`${skipReason}, skipping: ${path}`);
	// 				}else{
	// 					try{
	// 						var tObj=await getUriDetails(path);
	// 						switch(storeCallback(tObj)){ //this method should never throw error
	// 							case 'added':
	// 								scanLibrary_log('trace',`Added new track: ${path}`) //remember, library will also log stuff
	// 								added++;
	// 								break;
	// 							case 'updated':
	// 								scanLibrary_log('trace',`Updated track: ${path}`) //remember, library will also log stuff
	// 								updated++;
	// 								break;
	// 							case 'same':
	// 								scanLibrary_log('trace',`Existing track: ${path}`) //remember, library will also log stuff
	// 						}

	// 					}catch(err){
	// 						if(types){ //we know from ^^ that if there were types, then it had an audio/video type
	// 							failed.push(path);
	// 							scanLibrary_log('note',`Failed to parse supposed audio/video file: '${path}'.`,err.msg);
	// 						}else{							
	// 							scanLibrary_log('trace',`Not a valid audio file: '${path}'.`,err.msg); //no need to log the whole error, just the 
	// 																				  //part that says which command failed so we can try it ourselves
	// 						}
	// 					}

	// 				}

	// 				//Before moving on to the next file, check if we've increased progress by at least 1 pp, in which case emit
	// 				let p=Math.floor((i/total)*100);
	// 				if(p>progress){
	// 					progress=p;
	// 					ee.emit('progress',progress)
	// 				}

	// 			}

	// 			//Any finally, emit done and return
	// 			var msg='',success=true,lvl='info';
	// 			if(added)
	// 				msg+=`Added ${added} new track(s)`
	// 			if(updated)
	// 				msg+=(msg?', and updated ':'Updated ')+`${updated} track(s)`
	// 			if(failed.length){
	// 				msg+=(msg?' successfully, but there ':'There ')+'were errors with'+(msg?' ':' all ')+`${failed.length} tracks`
	// 				success=false;
	// 				lvl='warn';
	// 			}
	// 			msg+='.';

	// 			ee.emit('done',success, msg);
	// 			log[lvl](msg,failed);
	// 			return;

	// 		}catch(err){
	// 			let msg='Failed to scan entire local library.';
	// 			log.makeError(err).addHandling(msg).exec();
	// 			ee.emit('done',false,`Error. ${msg}`)
	// 		}
	// 	},1);

	// 	//And finally return the emitter before starting the scan
	// 	return ee;
	// }
