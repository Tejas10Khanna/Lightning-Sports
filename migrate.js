import fs from 'fs';
import path from 'path';

// Your desktop folder containing the exported WordPress files
const sourcePath = 'C:/Users/tejas/Desktop/files'; 
// Your new Astro content folder
const targetPath = path.join(process.cwd(), 'src', 'content', 'posts');

function processDirectory(directory) {
  const items = fs.readdirSync(directory);

  for (const item of items) {
    const fullPath = path.join(directory, item);

    if (fs.statSync(fullPath).isDirectory()) {
      // If it's a folder, look inside it
      processDirectory(fullPath);
    } else if (item === 'index.md') {
      // We found an index.md! Grab the name of the folder it is sitting in.
      const folderName = path.basename(directory);
      
      // Rename it to match the folder 
      const newFileName = `${folderName}.md`;
      const destination = path.join(targetPath, newFileName);

      // Copy and rename the file into the Astro content folder
      fs.copyFileSync(fullPath, destination);
      console.log(`Success: Copied and renamed to -> ${newFileName}`);
    }
  }
}

console.log('Starting the migration...');
processDirectory(sourcePath);
console.log('Migration complete! Check your src/content/posts folder.');