import { google } from 'googleapis';

let connectionSettings: any;
let tokenFetchedAt: number = 0;
const TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000; // Refresh every 30 minutes

async function getAccessToken() {
  const now = Date.now();
  const expiresAt = connectionSettings?.settings?.expires_at 
    ? new Date(connectionSettings.settings.expires_at).getTime() 
    : 0;
  
  // Re-fetch if: no cached settings, token expired, or 30 min since last fetch
  const needsRefresh = !connectionSettings 
    || (expiresAt > 0 && expiresAt <= now + 60000) // expires within 1 minute
    || (now - tokenFetchedAt > TOKEN_REFRESH_INTERVAL);
  
  if (!needsRefresh && connectionSettings?.settings?.access_token) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch Google Drive credentials');
  }
  
  const data = await response.json();
  connectionSettings = data.items?.[0];
  tokenFetchedAt = now;

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Drive not connected. Please connect your Google Drive account first.');
  }
  return accessToken;
}

async function getGoogleDriveClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

export function extractFolderId(url: string): string {
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]+)$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  throw new Error('Invalid Google Drive folder URL. Please provide a valid folder link.');
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

export async function listImagesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = await getGoogleDriveClient();
  
  const imageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  const mimeQuery = imageTypes.map(t => `mimeType='${t}'`).join(' or ');
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeQuery}) and trashed=false`,
    fields: 'files(id, name, mimeType, size)',
    pageSize: 100,
  });
  
  if (!response.data.files || response.data.files.length === 0) {
    return [];
  }
  
  return response.data.files.map(file => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType!,
    size: file.size || undefined,
  }));
}

export async function downloadImage(fileId: string): Promise<Buffer> {
  const drive = await getGoogleDriveClient();
  
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  
  return Buffer.from(response.data as ArrayBuffer);
}
