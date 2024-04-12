var cp = require('child_process');

var child = cp.exec("node -e 'while (true);'");
console.log(`Running child with pid ${child.pid}`);
