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
    const cX=scope.util.cX
    const fsX=scope.util.fsX 
    const cpX=scope.util.cpX
    const ffprobe=scope.api.local.ffprobe







	/*
	* This player reads a file from the local filesystem using 'sox'
	*and outputs it to a fifo called /tmp/music3
	*
	*/
	function LocalFiles(){


		Object.defineProperty(this,'log',{value:new BetterLog(this)});	



		//Make sure we can always access 'this' in methods, without having to 'bind' them
		const self = this;
		

		/*
		* @var object _private 		Holds all private properties... for clarity
		* @access private
		*/
		var _private={};


	
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
		this.canPlayUri=async function canPlayUri(uri){
			try{
				uri=cX.trim(uri,true); //typeerror if not string

				if(uri.substring(0,6)!='file:/'){
					//Just to be sure, if it starts with a '/', check if we got a regular path... without throwing on fail
					if(uri.substr(0,1)=='/' && fsX.exists(uri,'file'))
						return true
					return false
				}
				
				fsX.exists(toPath(uri),'file','throw');
				return true;

			}catch(err){
				err=this.log.makeError(err);

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
		this.getUriDetails=async function getUriDetails(uri){		
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
				return this.log.makeError(err).addHandling('call canPlayUri() before getUriDetails()').setCode('ESEQ').reject();
			}
		}




		/*
		* Play a file on the local filesystem as a wav stream
		*
		* @param object track 	@see this.getUriDetails(); 	
		*
		* @return string
		*/
		this.getStream=function(track){
			if(!track || typeof track !='object' || track.type!='track')
				self.log.throwType("track object",track);

			try{
				//Just make sure to get a valid path (else errors seem to take a while to track down... has happened twice now...)
				fsX.exists(track.contents,'file','throw');

				return track.contents;
			}catch(err){
				return this.log.makeError(err).addHandling('call getUriDetails() before getStream()').setCode('ESEQ').reject();
			}
		}	


		var uriList;
		/*
		* Get an object with all uri's known to this player
		*
		* @return array|<SmartArray> 	If no settings.libraryPaths have been specified, then an empty array, else a 
		*								SmartArray that will be appended with all uri's we find, including when new 
		*								uri's are found at a later time (eg. if we connect a USB drive)
		*/
		this.getUriList=function(){
			if(uriList)
				return uriList

			if(settings.paths && settings.paths.length){
				uriList=ffprobe_scan.call(this, settings.paths, 'file:',settings.includeVideo); //call.this => for logging
				return uriList;
			}else{
				this.log.note("No settings.libraryPaths specified, no local files will be added");
				return []
			}


		}
































		/*
		* Quickly check if a file contains a supported audio stream or not, while saving the output from ffprobe_raw() 
		* so that ffprobe() can be called within 60 sec without having to query the system again
		*
		* @param string path 	
		*
		* @return Promise(path|undefined,<ble TypeError>) 	 	Cleaned and normalized $path if it's supported, else undefined.
		*/
		function ffprobe_supported(path){
			try{path=toPath(path)}catch(err){return Promise.reject(err)}

			var args=[
				'-v','quiet'
				,'-select_streams','a'
				,'-show_streams'
				,'-of','json'
				,path
			]

			return ffprobe_raw(path,timeout)
				.then(
					str=>str.includes('index')?path:undefined //if it has a stream we support, it has the string 'index'
					,err=>undefined //happens if no file exists... 
				)
		}

		var ffprobe_cache={};
		var ffprobe_timeout;
		function ffprobe_raw(path,timeout=100){
			try{path=toPath(path)}catch(err){return Promise.reject(err)}
			
			if(ffprobe_cache.hasOwnProperty(path)){
				return Promise.resolve(ffprobe_cache[path]);
			}

			var args=[
				'-v','error'
				,'-select_streams','a:0'
				,'-show_streams'
				,'-show_format'
				,'-of','json'
				,path
			]

			return cpX.execFileInPromise('ffprobe',args, {timeout:timeout, encoding:'utf8'})
				.then(function ffprobe_success(json){
					ffprobe_cache[path]=json;

					//The cache is only meant to live for a little while so we don't have to call this method twice 
					//in close succession but at the same time not creating an extra memory footprint. But, we also
					//don't want to have thousands of timeouts removing each individual cache entry, so we just say
					//that the entire cache lives for no more than 1 minute, meaning that something added as sec. 59
					//will be deleted 1s later
					if(!ffprobe_timeout){
						ffprobe_timeout=setTimeout(function clearFFprobeCache(){
							self.log.trace("Clearing cache...");
							ffprobe_cache={};
							ffprobe_timeout=undefined;
						})
					}
					
					return json;
				})
		}



		function ffprobe(path,timeout=100){
			try{path=toPath(path)}catch(err){return Promise.reject(err)}

			var args=[
				'-v','error'
				,'-select_streams','a:0'
				,'-show_streams'
				,'-show_format'
				,'-of','json'
				,path
			]

			return cpX.execFileInPromise('ffprobe',args, {timeout:timeout, encoding:'utf8'})
				.catch(function ffprobe_fail(obj){
					//If any stderr exists, print that
					self.log.warn(obj);
					let extra=obj.stderr ? cX.limitString('STDERR:\n'+obj.stderr,500) : undefined;
					throw self.log.makeError(obj.error,extra); //will include path and 'ffprobe'
				})
				.then(function ffprobe_success(obj){
					var info=cX.tryJsonParse(obj.stdout);
					if(!info)
						throw self.log.makeError(`ffprobe returned unexpected value for path '${path}':`,obj);
					else if(!Array.isArray(info.streams) || !info.streams.length || !info.format)
						throw self.log.makeError(`ffprobe didn't return all requested data for '${path}':`,info);
					
					try{
						//grab the info we need using some fancy destructuring assignment
						var {streams:[s],format:f}=info
						s=cX.keysToLower(s);
						f=cX.keysToLower(f);
						var t=f.tags ? cX.keysToLower(f.tags): {};

						return {
							codec:cX.toLower(s.codec_name,null)
							,format:cX.toLower(f.format_name,null).split(',')[0] //eg. format 'hls' has format_name='hls,applehttp'
							,size:parseInt(f.size)||null
							,bit_rate:parseInt(f.bit_rate)||null
							,sample_rate:parseInt(s.sample_rate)||null
							,bit_depth:parseInt(s.bits_per_raw_sample)||null
							,channels:parseInt(s.channels)||null
							,duration:parseInt(s.duration)||null
							,title:t.title||t.name||null
							,album:t.album||null
							,artist:t.artist || t.albumartist || t.album_artist || t.composer||null
							,year:(new Date(t.year || t.date)).getFullYear() || null
							,genre:t.genre || null
						};
					}catch(err){
						global.log.makeError('Failed while extracting info from ffprobe result.',info,err).throw();
					}
				})
			;
			
		}





		/*
		* Scan one or more locations for audio files supported by ffmpegPopulate an array with all audio files in the settings.paths and add them to uriList. 
		* 
		* NOTE: this.log will be used if available, else cX.log
		*
		* @param array locations			Array of string paths to search
		* @param string prepend 			Something to prepend each filepath with, defaults to 'file:' 
		* @param boolean includeVideo 		If true, video files with audio tracks will be included
		*
		* @throw <ble TypeError>
		* @return <SmartArray> 		A smart array that get's appended with each supported file it finds
		*/
		function ffprobe_scan(locations,prepend='file:',includeVideo=false){
			var log=this.log||cX._log;
			cX.checkTypes(['array','string',['boolean','undefined']],[locations,prepend,includeVideo]);
			log.info(`Scanning for files in ${locations.length} locations:`,locations)
			var uriList=new smart.Array();
			locations.forEach(root=>{
				fsX.find(root,{type:'f',log:log,callback:
					function addAudioFile(path){
						try{
							if(isAudioExtension(path,includeVideo)===false)
								return;

							path=ffprobe_supported(path);
							if(path)
								uriList.push(path);

							return path; //return so the logs show the right number of files...
						}catch(err){
							log.makeError(err).addHandling('root:',root).addHandling('file:',path).exec();
						}
					}
				}).catch(function find_failed(err){log.error('Failed to scan library path:',root,err)})
			});
			return uriList;
		}


		/*
		* Check if a filepath has a known audio (or video, @see $includeVideo) extension
		*
		* @param string path
		* @param boolean includeVideo
		*
		* @return boolean|undefined 	true=>definately audio, false=>definately not audio, undefined=>unsure, you'll have to try
		*/
		function isAudioExtension(path,includeVideo){
			let ext=fsX.path.extname(path);
			if(!ext)
				return undefined;
			let types=fsX.fileExtType(ext);
			if(!types)
				return undefined;
			return (!types.includes('audio') && !types.includes('video')) ? false : true;
		}










		/*
		* @func scanLibrary			Scan this.options.libraryPaths for any playable files
		*
		* @param func storeCallback 		Each found playable file will be passed to getFileInfo() and the resulting promise 
		*										passed to this callback
		* @param func *includeFilter 		Optional. Filter function that returns true if the file should be included.
		* 
		* @return <BetterEvents> 	Emits 3 events:
		*								'progress'(number) 		Integer between 0-100, percentage done
		*								'msg'(string, string) 	First string can be 'verbose', 'info', 'note','error'. Second is the message
		*								'done'(bool,string) 	First arg is success, second is end status/ouctcome
		* @async
		* @access public
		*/
		this.scanLibrary=function(storeCallback,includeFilter){
			this.log.traceFunc(arguments);

			//Create an event emitter we can return
			var ee=new BetterEvents();

			var l=this.log;
			function scanLibrary_log(lvl,msg,...extra){ //named this way so log shows good things
				let ble=new global.class.BetterLogEntry(lvl,msg,extra,l).changeWhere(1).exec();
				lvl=(ble.lvl<3 ? 'verbose':lvl);
				ee.emit(lvl,msg);
			}

			//Then trigger a timeout to fire in 1ms
			var self=this;
			setTimeout(async function _scanLibrary(){
				try{

					//First get a list of files from each location
					let locations=self.options.get('libraryPaths')
					let l=locations.length
					if(l>1)

						scanLibrary_log('info',`LocalFiles is going to scan ${locations.length} locations...`);
					else
						scanLibrary_log('info',`LocalFiles is going to scan ${locations[0]}...`);

					var i,allFiles=[];
					for(i in locations){
						try{
							let root=locations[i];
							if(l>1)
								scanLibrary_log('info',`Scanning: ${root} ...`);
							
							//Scan the path for files using linux 'find', getting a single newline-delimited strings of files under this 'root'
							var {stdout}=await cpX.execFileInPromise('find',[root,'-type','f']); //get 
							
							//Split ^^ into array of filepath strings	
							var files=stdout.split('/n').reduce((pathsArr,str)=>pathsArr.concat( //3. Merge into pathsArray
										str.split('\n').filter(path=>path!='')//2. Split strings into arrays (and discard trailing empty)
									)
									,[] //1. start with empty array, soon to contain paths
								)

							let before=files.length
							if(!before){
								if(l>1)
									scanLibrary_log('info',`No files found in that location.`);
							}else{
								if(l>1)
									scanLibrary_log('info',`Found ${before} files...`);
								allFiles=allFiles.concat(files);
							}

						} catch(err){
							scanLibrary_log('error',`Failed to scan ${root}`,err);
						}
					}

					if(!allFiles.length){
						ee.emit('done',false,"No files found"); //false==this is a failure
						l.note("Scanning done, no files found");
						return;
					}


					//Now handle each file, emitting 'progress' and 'verbose' as we go
					let total=allFiles.length;
					scanLibrary_log("info",`Found a total of ${total} files in all folders. Processing...`);
					var added=0,updated=0,failed=[],progress=0;
					ee.emit("progress",progress);
					var path,skipReason;
					for(i in allFiles){
						let path=allFiles[i];
						let ext=fsX.path.extname(path);
						let types=fsX.fileExtType(ext);
						
						//Ignore files that don't have an extension or has a known extension of another type
						if(!ext || (types && !types.includes('audio') && !types.includes('video'))){
							scanLibrary_log("trace",`Not an audio file, skipping: ${path}`);
						}else if(includeFilter && (skipReason=includeFilter(path))){
							scanLibrary_log("trace",`${skipReason}, skipping: ${path}`);
						}else{
							try{
								var tObj=await getUriDetails(path);
								switch(storeCallback(tObj)){ //this method should never throw error
									case 'added':
										scanLibrary_log('trace',`Added new track: ${path}`) //remember, library will also log stuff
										added++;
										break;
									case 'updated':
										scanLibrary_log('trace',`Updated track: ${path}`) //remember, library will also log stuff
										updated++;
										break;
									case 'same':
										scanLibrary_log('trace',`Existing track: ${path}`) //remember, library will also log stuff
								}

							}catch(err){
								if(types){ //we know from ^^ that if there were types, then it had an audio/video type
									failed.push(path);
									scanLibrary_log('note',`Failed to parse supposed audio/video file: '${path}'.`,err.msg);
								}else{							
									scanLibrary_log('trace',`Not a valid audio file: '${path}'.`,err.msg); //no need to log the whole error, just the 
																						  //part that says which command failed so we can try it ourselves
								}
							}

						}

						//Before moving on to the next file, check if we've increased progress by at least 1 pp, in which case emit
						let p=Math.floor((i/total)*100);
						if(p>progress){
							progress=p;
							ee.emit('progress',progress)
						}

					}

					//Any finally, emit done and return
					var msg='',success=true,lvl='info';
					if(added)
						msg+=`Added ${added} new track(s)`
					if(updated)
						msg+=(msg?', and updated ':'Updated ')+`${updated} track(s)`
					if(failed.length){
						msg+=(msg?' successfully, but there ':'There ')+'were errors with'+(msg?' ':' all ')+`${failed.length} tracks`
						success=false;
						lvl='warn';
					}
					msg+='.';

					ee.emit('done',success, msg);
					self.log[lvl](msg,failed);
					return;

				}catch(err){
					let msg='Failed to scan entire local library.';
					self.log.makeError(err).addHandling(msg).exec();
					ee.emit('done',false,`Error. ${msg}`)
				}
			},1);

			//And finally return the emitter before starting the scan
			return ee;
		}


	} //end of LocalFiles




	return LocalFiles


};




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
		// 							self.log.error(obj);
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
		// 			self.log.error('Failed to parse track comments for info',err)
		// 		}
		// 			// self.log.info("File info: ",info);
		// 		return resolve(info);
		// 	}catch(err){return reject(err);}});
		// }



