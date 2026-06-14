const fs = require('fs');
const path = require('path');

function getDirSize(dirPath) {
    let size = 0;
    const files = fs.readdirSync(dirPath);

    for (let i = 0; i < files.length; i++) {
        const file = path.join(dirPath, files[i]);
        const stats = fs.statSync(file);

        if (stats.isDirectory()) {
            if (files[i] !== 'node_modules' && files[i] !== '.git' && files[i] !== 'dist') {
                size += getDirSize(file);
            }
        } else {
            size += stats.size;
        }
    }
    return size;
}

try {
    console.log('Client size (MB):', (getDirSize('d:/Rishi/Own Extensions Apps/Arknight Hackathon Shi/SpaceTracker/client') / 1024 / 1024).toFixed(2));
    console.log('Server size (MB):', (getDirSize('d:/Rishi/Own Extensions Apps/Arknight Hackathon Shi/SpaceTracker/server') / 1024 / 1024).toFixed(2));
} catch(e) {
    console.error(e);
}
