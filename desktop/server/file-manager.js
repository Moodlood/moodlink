/**
 * MoodLink File Manager Module
 * Handles file system browsing, listing, and operations
 */
const fs = require('fs');
const path = require('path');

class FileManager {
  constructor() {
    this.uploadsDir = path.join(__dirname, '..', 'uploads');
  }

  listDirectory(dirPath) {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items.map(item => {
        const fullPath = path.join(dirPath, item.name);
        const stats = fs.statSync(fullPath);
        return {
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
          size: item.isDirectory() ? 0 : stats.size,
          modified: stats.mtime.toISOString(),
          extension: item.isDirectory() ? '' : path.extname(item.name).toLowerCase()
        };
      }).sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      return [];
    }
  }

  getFileInfo(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        extension: path.extname(filePath).toLowerCase(),
        isDirectory: stats.isDirectory()
      };
    } catch (err) {
      return null;
    }
  }

  deleteFile(filePath) {
    try {
      if (fs.statSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true });
      } else {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getFileIcon(ext) {
    const icons = {
      '.pdf': '📄', '.doc': '📝', '.docx': '📝', '.txt': '📃',
      '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.svg': '🖼️', '.webp': '🖼️',
      '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
      '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵',
      '.zip': '📦', '.rar': '📦', '.7z': '📦', '.tar': '📦',
      '.exe': '⚙️', '.msi': '⚙️',
      '.js': '💻', '.py': '💻', '.html': '💻', '.css': '💻',
      '.xls': '📊', '.xlsx': '📊', '.csv': '📊',
      '.ppt': '📊', '.pptx': '📊',
    };
    return icons[ext] || '📁';
  }
}

module.exports = FileManager;
