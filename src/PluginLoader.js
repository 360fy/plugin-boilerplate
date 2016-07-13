import FS from 'fs';
import Path from 'path';
import Promise from 'bluebird';
import md5 from 'md5';
import * as babel from 'babel-core';

const fsPromise = Promise.promisifyAll(FS);

function handlePluginError(error, throwError, directory) {
    if (error) {
        if (error.code === 'ENOENT') {
            console.error(`>>> ERROR: No such file or directory at ${directory}`);
        } else if (error.code === 'MODULE_NOT_FOUND') {
            if (throwError) {
                console.error(`>>> ERROR: Bad module at ${directory} :`, error.message);
            }
        } else {
            console.error(`>>> ERROR: Module error at ${directory} :`, error);
        }

        if (throwError) {
            // exit process on any error
            process.exit(1);
        }
    }

    return null;
}

function requireResolve(path) {
    try {
        return require.resolve(path);
    } catch (error) {
        return Promise.reject({code: 'MODULE_NOT_FOUND', message: error.message});
    }
}

const READ_PERMISSION = FS.R_OK;
const READ_WRITE_PERMISSION = FS.R_OK | FS.W_OK;

function existsFile(file, permission) {
    return Promise.resolve(fsPromise.accessAsync(file, permission))
      .then(() => true)
      .catch(() => false);
}

function pluginRootDirectory(moduleRoot) {
    return Path.resolve(moduleRoot || process.env.MODULE_ROOT, '.__plugin__');
}

function pluginLink(moduleRoot, pluginKey) {
    return Path.resolve(pluginRootDirectory(moduleRoot), pluginKey);
}

function createPluginRootDirectory(moduleRoot) {
    const directory = pluginRootDirectory(moduleRoot);

    return Promise.resolve(existsFile(directory, READ_WRITE_PERMISSION))
      .then(value => {
          if (!value) {
              console.warn(`Plugin Directory ${directory} either does not exist or not accessible`);
              return fsPromise.mkdirAsync(directory);
          }

          return true;
      });
}

// function createPluginLink(pluginSrc, link) {
//     return Promise.resolve(existsFile(link, READ_WRITE_PERMISSION))
//       .then(value => {
//           if (!value) {
//               return fsPromise.linkAsync(pluginSrc, link);
//           }
//
//           return true;
//       });
// }

function babelTransform(srcFile, destFile) {
    return new Promise((resolve, reject) => {
        babel.transformFile(srcFile, (error, result) => {
            if (error) {
                console.error(`Error in babel compiling ${srcFile} - ${error}`);
                reject(error);
                return;
            }

            // if file exist, then delete it
            Promise.resolve(existsFile(destFile, READ_WRITE_PERMISSION))
              .then(value => {
                  if (!value) {
                      return true;
                  }

                  return fsPromise.unlinkAsync(destFile);
              })
              .then(() => {
                  const stream = FS.createWriteStream(destFile);

                  stream.on('finish', () => {
                      resolve(true);
                  });

                  stream.write(result.code);
                  stream.end();
              });
        });
    });
}

export default (moduleRoot, path, throwError) => {
    console.log('Scanning config at: ', path);

    let pluginPath = null;

    return Promise.resolve(requireResolve(path))
      .then(directory => {
          pluginPath = directory;
          return fsPromise.accessAsync(pluginPath, READ_PERMISSION);
      })
      .then(() => createPluginRootDirectory(moduleRoot))
      .then(() => fsPromise.statAsync(path)) // check path of original
      .then(stats => {
          const pluginKey = md5(pluginPath);
          const link = pluginLink(moduleRoot, pluginKey);

          if (stats.isFile()) {
              console.log(`Babel compiling plugin ${pluginPath} to ${link}`);

              return Promise.resolve(babelTransform(pluginPath, link))
                .then(() => require(link))
                .then((config) => config.default);
          } else if (stats.isDirectory()) {
              return require(pluginPath);
          }

          throw new Error('Plugin Path must be Global NPM Module, NPM Module Directory, or JS Config File');
      })
      .then(config => {
          console.log('Resolved plugin at: ', pluginPath);

          return config;
      })
      .catch(error => handlePluginError(error, throwError, path));
};