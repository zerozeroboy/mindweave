import { useState, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { getBackend } from '../backend';

export function useFilePreview(currentWorkspace: Workspace | null) {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [filePreview, setFilePreview] = useState<MirrorReadFileResult | null>(null);
  const backend = useMemo(() => getBackend(), []);

  // Reset File Preview on Workspace Change
  useEffect(() => {
    setSelectedFile("");
    setFilePreview(null);
  }, [currentWorkspace?.name]);

  const openFile = async (filePath: string) => {
    if (!currentWorkspace) return;
    setSelectedFile(filePath);
    try {
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filePath);
      const result = await backend.readMirrorFile(currentWorkspace.name, filePath, isImage ? 2_000_000 : 20_000);
      setFilePreview(result);
    } catch (error) {
      message.error(`Read file failed: ${(error as Error).message}`);
    }
  };

  return {
    selectedFile,
    setSelectedFile,
    filePreview,
    setFilePreview,
    openFile
  };
}
