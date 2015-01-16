/*
 *  Gulpfile
 *  https://github.com/gulpjs/gulp/blob/master/docs/API.md
 *  https://github.com/gulpjs/gulp/tree/master/docs/recipes
 * =====================================================================
 */
'use strict';

// node modules
var _               = require('lodash'),
    path            = require('path'),
    del             = require('del'),
    minimist        = require('minimist'),
    browserSync     = require('browser-sync'),
    mqpacker        = require('css-mqpacker'),
    csswring        = require('csswring'),
    stylish         = require('jshint-stylish'),
    buffer          = require('vinyl-buffer'),
    source          = require('vinyl-source-stream'),
    browserify      = require('browserify'),
    watchify        = require('watchify'), // watch for browserify builds
    runSequence     = require('run-sequence'),
    gulp            = require('gulp');

// custom gulp modules
var bundleLogger    = require(process.cwd() + '/gulp/util/bundleLogger.js'),
    handleErrors    = require(process.cwd() + '/gulp/util/handleErrors.js');

//external data -  config, metadata, package.json
var config  = require(process.cwd() + '/config.js'),
    pkg     = require(process.cwd() + '/package.json');

// auto-require plugins
// https://www.npmjs.com/package/auto-plug
var autoPlug = require('auto-plug'),
    // gulp plugins
    g   = autoPlug({
            config: pkg
        });

/**
 *  Parse CLI params
 * =====================================================================
 */
var params = (function(p){
        var cliParams = minimist(process.argv.slice(2));
        // First check the cli params for environment flag
        // Then check NODE_ENV environment variable
        // Then check config.js
        // Finally, fall back to explicitly specifying 'development'
        p.environment = cliParams.environment || cliParams.env || process.env.NODE_ENV || config.gulpParams.environment || 'development';
        return p;
    })({});

/* = Parse CLI params */

/**
 *  BrowserSync
 * =====================================================================
 */
gulp.task('browsersync', ['build:all'], function() {
    var bsConfig = config.browsersync.development;

    browserSync(bsConfig);
});

/* = BrowserSync */

/**
 *  Sass / Scss / CSS processing
 * =====================================================================
 */
gulp.task('build:css', function() {
    var sassConfig = config.sass.options;

    sassConfig.onError = browserSync.notify;

    // we don't want to write sourcemaps of sourcemaps, so we filter those out
    var filter = g.filter(['*.css', '!*.map']);

    browserSync.notify('Compiling Sass');

    return gulp.src(config.sass.src)
        // normally, the gulp process would crash if you have a Sass syntax error
        // but plumber keeps the gulp task from crashing
        .pipe(g.plumber())
        // initialize sourcemaps processor
        .pipe(g.sourcemaps.init({ loadMaps: true }))
        // pipe through sass/scss processor
        .pipe(g.sass(sassConfig))
        .pipe(g.autoprefixer(config.autoprefixer))
        .pipe(filter) // Don't write sourcemaps of sourcemaps, remember?
        // write sourcemaps
        .pipe(g.sourcemaps.write('.', { includeContent: false }))
        // Restore original files
        .pipe(filter.restore())
        // write processed sass files as css files to output destination
        .pipe(gulp.dest(config.sass.dest));

});

/* = Sass / SCSS / CSS processing */


/**
 *  JavaScript processing with Browserify
 * =====================================================================
 */

gulp.task('build:js', function(callback) {

    browserSync.notify('Compiling JavaScript');

    var bfyConfig = config.browserify;

    var bundleQueue = bfyConfig.bundleConfigs.length;

    var browserifyThis = function( bundleConfig ) {

        var bundler = browserify({
            // watchify args
            cache: {}, packageCache: {}, fullPaths: true,
            // app entry point
            entries: bundleConfig.entries,
            // optional file extensions allowed in require
            extensions: bfyConfig.extensions,
            // should enable source maps?
            debug: bfyConfig.debug
        });

        var bundle = function() {
            // log when starting a bundle
            bundleLogger.start(bundleConfig.outputName);

            return bundler
                .bundle()
                // report any errors during compilation
                .on('error', handleErrors)
                // make stream compatible with gulp
                // and specify output file name
                .pipe(source(bundleConfig.outputName))
                // output destination
                .pipe(gulp.dest(bundleConfig.dest))
                .on('end', reportFinished);
        };

        if (global.isWatching) {

            gutil.log('Watchify enabled');
            // wrap with watchify and re-bundle
            bundler = watchify(bundler);
            // re-bundle after updates
            bundler.on('update', bundle);
        } else {
            // handle shared dependencies
            // b.require exposes modules externally
            if( bundleConfig.require ) {
                bundler.require(bundleConfig.require);
            }

            // b.external prevents specified modules from being included in
            // the bundle, and expects the excluded modules to be available
            // externally
            if ( bundleConfig.external ) {
                bundler.external(bundleConfig.external);
            }
        }

        var reportFinished = function() {
            // log bundling complete
            bundleLogger.end(bundleConfig.outputName);

            if (bundleQueue) {
                bundleQueue--;

                if (bundleQueue === 0) {
                    // if queue is empty, tell gulp the task is finished
                    callback && callback();
                }

                // reload on changes
                browserSync.reload();
            }
        };

        return bundle();
    };

    // start browserify bundling
    bfyConfig.bundleConfigs.forEach(browserifyThis);
});

/* = JavaScript processing with Browserify */


/**
 *  Generate sprite and CSS file from png files
 * =====================================================================
 */
gulp.task('build:sprites', function() {
    var spriteConfig = config.sprites;

    // use spritesmith to build the sprite image and sprite css
    // from the constituent images
    var spriteData = gulp
                        .src(spriteConfig.src)
                        .pipe(g.spritesmith(spriteConfig.options));

    // pipe the sprite image to the configured image folder
    spriteData.img
        .pipe(gulp.dest(spriteConfig.dest.image));
    // pipe the sprite css to the configured css folder
    spriteData.css
        .pipe(gulp.dest(spriteConfig.dest.css));
});

/* = Generate sprite and CSS file from png files */


/**
 *  Build All process
 * =====================================================================
 */
gulp.task('build:all', function(callback) {
    // first, run the delete task
    // then run the array of tasks (they will run in parallel)
    // then run the base64 task
    // finally, execute optional callback
    // we need to use an order, controlled sequence here because
    // we don't want to run the base64 task until
    // the sass has been processed into css
    runSequence('delete',
    [
        'build:css',
        'build:js',
        'copy:templates',
        'copy:images',
        'copy:fonts'
    ],
    'base64',
    callback);
});

/* = Build all */

/**
 *  Copy templates (e.g., layouts)
 * =====================================================================
 */
gulp.task('copy:templates', function() {
    var templateConfig = config.templates;

    browserSync.notify('Copying Templates');

    return gulp.src(templateConfig.src)
        .pipe(gulp.dest(templateConfig.dest));
});

/* = Copy templates */


/**
 *  Reload templates
 * =====================================================================
 */
gulp.task('reload:templates', ['copy:templates'], function() {
    browserSync.reload();
});

/* = Reload templates */


/**
 *  Copy changed images to build folder
 * =====================================================================
 */
gulp.task('copy:images', function() {
    var imageConfig = config.images;

    return gulp.src(imageConfig.src)
        .pipe(g.changed(imageConfig.dest)) // Ignore unchanged files
        .pipe(gulp.dest(imageConfig.dest));
});

/* = Copy changed images */


/**
 *  Copy fonts to build folder
 * =====================================================================
 */
gulp.task('copy:fonts', function() {
    var fontConfig = config.copyfonts.development;

    return gulp.src(fontConfig.src)
        .pipe(g.changed(fontConfig.dest)) // Ignore changed files
        .pipe(gulp.dest(fontConfig.dest));
});

/* = Copy fonts */



/**
 *  Replace image URLs in CSS with base64 encoded data
 * =====================================================================
 */
gulp.task('base64', ['build:css'], function() {
    var base64Config = config.base64;

    return gulp.src(base64Config.src)
        .pipe(g.base64(base64Config.options))
        .pipe(gulp.dest(base64Config.dest));
});

/* = Replace image URLs in CSS with base64 encoded data */


/**
 *  Delete / Clean build folders and files
 * =====================================================================
 */
gulp.task('delete', function(callback) {
    var delConfig = config.delete;

    del(delConfig.src, callback);
});

/* = Delete / clean build folders and files */


/**
 *  Lint CSS
 * =====================================================================
 */
gulp.task('lint:css', function() {
    var lintConfig = config.csslint;

    return gulp.src(lintConfig.src)
        .pipe(g.csslint(lintConfig.options));
});

/* = Lint CSS */



/**
 *  Lint JS
 * =====================================================================
 */
gulp.task('lint:js', function() {
    var lintConfig = config.jshint;

    return gulp.src(lintConfig.src)
        .pipe(g.jshint(lintConfig.options.level))
        .pipe(g.jshint.reporter(lintConfig.options.reporter));
});

/* = Lint JS */


/**
 *  Watch task - start browser-sync and watch for file changes
 * =====================================================================
 */
gulp.task('watch', ['browsersync'], function() {
    var wc = config.watch;

    gulp.watch(wc.templates, ['reload:templates']);
    gulp.watch(wc.sass, ['build:css', 'lint:css']);
    gulp.watch(wc.scripts, ['lint:js', 'build:js']);
    gulp.watch(wc.images, ['copy:images']);
    gulp.watch(wc.svg, ['copy:fonts']);
    gulp.watch(wc.sprites, ['build:sprites']);
});

/* = Watch task */


/**
 *  Default task - task run when no task runner params are specified
 * =====================================================================
 */
gulp.task('default', ['watch']);

/* = Default task */
