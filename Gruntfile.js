// ---
// Grunt.js Build configuration

// From the root of your project, run `grunt release` to build the files in production mode.
// For debugging purpose, use `grunt debug` to prevent minification of CSS and JS scripts files.
// During developpement, use `grunt watch:compass` to compile SCSS files on changes and use
// `grunt watch:scripts` to watch changes and build a debuggable version of your scripts.

// This is the main application configuration file.  It is a Grunt
// configuration file, which you can learn more about here:
// https://github.com/cowboy/grunt/blob/master/docs/configuring.md

/*global module */
module.exports = function( grunt ) {
	"use strict";

	grunt.initConfig({
		
		// The clean task ensures all files are removed from the dist/ directory so
		// that no files linger from previous builds.
		clean: {
			all: [
				"dist/",
				"extension/app/app_build.js",
				"extension/app/app_build.min.js",
				"extension/app/source-map.js"
			],
			build: [ "dist/" ],
			bower: [ "components/" ]
		},
		
		// Lint javascript to ensure minimum quality check
		jshint: {
			files: [ "extension/app/**/*.js" ],
			options: {
				browser: true,
				scripturl: true,
				smarttabs: true,
				expr: true,
				globals: [ "require", "define" ]
			}
		},
		
		// Smushit task will compress images through yahoo smushit services
		smushit: {
			compile: {
				src: "extension/assets/img"
			}
		},
		
		// The `jst` and `handlebars` task pre-compile template to save CPU on production
		// `handlebars`: compile Handlebars templates
		handlebars: {
			compile: {
				options: {
					wrapped: false,
					processName: function( filename ) {
						// normalize filename
						return filename.replace( 'extension/', '' );
					}
				},
				files: {
					"dist/debug/templates.js": [ "extension/app/templates/**/*.hbs" ]
				}
			}
		},
		
		// `concat` task is used to concatenate multiple files into one.
		concat: {
			dist: {
				src: [
					"extension/assets/js/requirejs/require.js",
					"dist/debug/templates.js",
					"dist/debug/app.js"
				],
				
				dest: "extension/app/app_build.js",
				
				separator: ";"
			}
		},
		
		// Minify javascript files (through Uglify.js)
		uglify: {
			app: {
				files: {
					"extension/app/app_build.min.js": [ "extension/app/app_build.js" ]
				},
				options: {
					sourceMap: 'extension/app/source-map.js',
					sourceMappingURL: 'source-map.js',
					sourceMapPrefix: 1
				}
			}
		},
		
		// `requirejs` task use `r.js` builde and optimizer tool for AMD modules
		requirejs: {
			compile: {
				options: {
					baseUrl: "extension/app/",
					
					// Include the main configuration file.
					mainConfigFile: "extension/app/config.js",
					
					// Output file.
					out: "dist/debug/app.js",
					
					// Root application module.
					name: "config",
					
					paths: {
						
						// Only replace Handlebars with the runtime if you're
						// not loading templates after build
						handlebars  : "../assets/js/handlebars/handlebars.runtime",
						
					},
					
					// Includes script to inline
					include: [
						
					],
					
					// Do not wrap everything in an IIFE.
					wrap: {
						// set baseUrl config if concat is used
						start: 'require.config({ baseUrl: "../app/", waitSeconds: 30 });',
						end: ' '
					},
					
					preserveLicenseComments: false,
					useSourceUrl: true,
					optimize: "none"
				}
			}
		},
		
		// Watch task checks for files changes, then execute the defined task
		watch: {
			scripts: {
				files: ['extension/app/**/*'],
				tasks: ['scripts']
			}
		},

		// Install browser deps with Bower
		bower: {
			options: {
				targetDir: "extension/assets"
			},
			install: {}
		}

	});
	
	grunt.loadNpmTasks('grunt-contrib');
	grunt.loadNpmTasks('grunt-smushit');
	grunt.loadNpmTasks('grunt-bower-task');
	
	grunt.registerTask("scripts", [
			"clean:all", "jshint", "handlebars", "requirejs", "concat", "clean:build", "uglify" ]);
	grunt.registerTask("install", [ "clean:bower", "bower:install" ]);
	grunt.registerTask("build", [ "scripts", "smushit" ]);
	
};
