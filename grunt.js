// This is the main application configuration file.  It is a Grunt
// configuration file, which you can learn more about here:
// https://github.com/cowboy/grunt/blob/master/docs/configuring.md

/*jshint strict:false */
/*global module */

module.exports = function( grunt ) {
	
	grunt.initConfig({
		
		// The clean task ensures all files are removed from the dist/ directory so
		// that no files linger from previous builds.
		clean: {
			all: [
				"dist/",
				"app/app_build.js"
			],
			build: [
				"dist/"
			]
		},
		
		// The lint task will run the build configuration and the application
		// JavaScript through JSHint and report any errors.  You can change the
		// options for this task, by reading this:
		// https://github.com/cowboy/grunt/blob/master/docs/task_lint.md
		lint: {
			files: [
				"app/**/*.js"
			]
		},
		
		// The jshint option for scripturl is set to lax, because the anchor
		// override inside main.js needs to test for them so as to not accidentally
		// route.
		jshint: {
			options: {
				browser: true,
				scripturl: true,
				smarttabs: true,
				expr: true
			}
		},
		
		// Smushit will run images through smushit services
		smushit: {
			path: {
				src: "img"
			}
		},
		
		// Pre-compile Handlebars templates
		
		handlebars: {
			compile: {
				options: {
					processName: function( filename ) {
						// normalize filename
						return filename.replace( 'www/', '' );
					}
				},
				files: {
					"dist/debug/templates.js": [ "app/templates/**/*.hbs" ]
				}
			}
		},
		
		// The concatenate task is used here to merge the almond require/define
		// shim and the templates into the application code.  It's named
		// dist/debug/require.js, because we want to only load one script file in
		// index.html.
		concat: {
			dist: {
				src: [
					"libs/require.js",
					"dist/debug/templates.js",
					"dist/debug/require.js"
				],
				
				dest: "app/app_build.js",
				
				separator: ";"
			}
		},
		
		// Takes the built require.js file and minifies it for filesize benefits.
		min: {
			"app/app_build.js": [ "app/app_build.js" ]
		},
		
		// This task uses James Burke's excellent r.js AMD build tool.  In the
		// future other builders may be contributed as drop-in alternatives.
		requirejs: {
			compile: {
				options: {
					baseUrl: "app/",
					
					// Include the main configuration file.
					mainConfigFile: "app/config.js",
					
					// Output file.
					out: "dist/debug/require.js",
					
					// Root application module.
					name: "config",
					
					paths: {
						
						// Set FB path to empty so it's ignored by the build
						facebook: "empty:",
						
						// Only replace Handlebars with the runtime if you're not loading any template after builds
						handlebars  : "../libs/handlebars.runtime",
						
					},
					
					// Includes script to inline
					include: [
						"modules/bookmarks.chrome",
						"modules/bookmarks.delicious"
					],
					
					//findNestedDependencies: true,
					
					// Exclude all deps depending on a third party script
					excludeShallow: [
						"facebook"
					],
					
					// Do not wrap everything in an IIFE.
					wrap: {
						// set baseUrl config if concat is used
						start: 'require.config({ waitSeconds: 30 });',
						end: ' '
					},
					
					preserveLicenseComments: false
				}
			}
		},
		
		// Running the server without specifying an action will run the defaults,
		// port: 8000 and host: 127.0.0.1.  If you would like to change these
		// defaults, simply add in the properties `port` and `host` respectively.
		// Alternatively you can omit the port and host properties and the server
		// task will instead default to process.env.PORT or process.env.HOST.
		//
		// Changing the defaults might look something like this:
		//
		// server: {
		//   host: "127.0.0.1", port: 9001
		//   debug: { ... can set host and port here too ...
		//  }
		//
		//  To learn more about using the server task, please refer to the code
		//  until documentation has been written.
		server: {
			//// Ensure the favicon is mapped correctly.
			//files: { "favicon.ico": "favicon.ico" },
			//
			//debug: {
			//  // Ensure the favicon is mapped correctly.
			//  files: { "favicon.ico": "favicon.ico" },
			//
			//  // Map `server:debug` to `debug` folders.
			//  folders: {
			//    "app": "dist/debug",
			//    "assets/js/libs": "dist/debug",
			//    "assets/css": "dist/debug"
			//  }
			//},
			//
			//release: {
			//  // This makes it easier for deploying, by defaulting to any IP.
			//  host: "0.0.0.0",
			//
			//  // Ensure the favicon is mapped correctly.
			//  files: { "favicon.ico": "favicon.ico" },
			//
			//  // Map `server:release` to `release` folders.
			//  folders: {
			//    "app": "dist/release",
			//    "assets/js/libs": "dist/release",
			//    "assets/css": "dist/release"
			//  }
			//}
		},
		
		
		// Recompile when files changes
		watch: {
			source: {
				files: [ 'app/**/*', 'grunt.js' ],
				tasks: [ 'debug' ]
			}
		}
		
	});
	
	grunt.loadNpmTasks('grunt-contrib');
	
	// @todo: add back `lint` task sometime
	grunt.registerTask("default", "clean:all handlebars requirejs concat clean:build");
	
	// The debug task is simply an alias to default to remain consistent with
	// debug/release.
	grunt.registerTask("debug", "default");
	
	// The release task will run the debug tasks and then minify the
	grunt.registerTask("release", "default min smushit");
	
};
