import fs from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';

/**
 * Geographic bounds in WGS84 (lat/lon)
 */
export interface GeoBounds {
    north: number;  // Max latitude
    south: number;  // Min latitude
    east: number;   // Max longitude
    west: number;   // Min longitude
}

/**
 * TFW (World File) data structure
 * See: https://en.wikipedia.org/wiki/World_file
 */
interface TfwData {
    pixelSizeX: number;      // Line 1: Pixel size in X direction (cell width)
    rotationY: number;       // Line 2: Rotation about Y axis (usually 0)
    rotationX: number;       // Line 3: Rotation about X axis (usually 0)
    pixelSizeY: number;      // Line 4: Pixel size in Y direction (usually negative)
    upperLeftX: number;      // Line 5: X coordinate of center of upper-left pixel
    upperLeftY: number;      // Line 6: Y coordinate of center of upper-left pixel
}

// Define coordinate reference systems
// UTM Zone 48N (commonly used for Ho Chi Minh City area)
const UTM_48N = '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

/**
 * Parse a TFW (World File) and return its data
 */
export function parseTfwFile(tfwPath: string): TfwData {
    if (!fs.existsSync(tfwPath)) {
        throw new Error(`TFW file not found: ${tfwPath}`);
    }

    const content = fs.readFileSync(tfwPath, 'utf-8');
    const lines = content.trim().split(/\r?\n/);

    if (lines.length < 6) {
        throw new Error(`Invalid TFW file: expected 6 lines, got ${lines.length}`);
    }

    return {
        pixelSizeX: parseFloat(lines[0]),
        rotationY: parseFloat(lines[1]),
        rotationX: parseFloat(lines[2]),
        pixelSizeY: parseFloat(lines[3]),
        upperLeftX: parseFloat(lines[4]),
        upperLeftY: parseFloat(lines[5])
    };
}

/**
 * Calculate geographic bounds from TFW file and image dimensions
 * 
 * @param tfwPath - Path to the .tfw file
 * @param imageWidth - Width of the image in pixels
 * @param imageHeight - Height of the image in pixels
 * @param sourceCrs - Source CRS (default: UTM Zone 48N)
 * @returns GeoBounds in WGS84 (lat/lon)
 */
export function calculateBoundsFromTfw(
    tfwPath: string,
    imageWidth: number,
    imageHeight: number,
    sourceCrs: string = UTM_48N
): GeoBounds {
    const tfw = parseTfwFile(tfwPath);

    console.log('TFW Data:', {
        pixelSizeX: tfw.pixelSizeX,
        pixelSizeY: tfw.pixelSizeY,
        upperLeftX: tfw.upperLeftX,
        upperLeftY: tfw.upperLeftY
    });

    // Calculate UTM bounds
    // The TFW coordinates point to the CENTER of the upper-left pixel
    // We need to find the EDGES of the image
    
    // Upper-left corner (edge, not center)
    const utmWest = tfw.upperLeftX - (tfw.pixelSizeX / 2);
    const utmNorth = tfw.upperLeftY - (tfw.pixelSizeY / 2); // pixelSizeY is negative
    
    // Lower-right corner (edge)
    const utmEast = utmWest + (imageWidth * tfw.pixelSizeX);
    const utmSouth = utmNorth + (imageHeight * tfw.pixelSizeY); // pixelSizeY is negative

    console.log('UTM Bounds:', {
        north: utmNorth,
        south: utmSouth,
        east: utmEast,
        west: utmWest
    });

    // Transform UTM to WGS84
    const transformer = proj4(sourceCrs, WGS84);

    // Transform corners
    const [lonWest, latNorth] = transformer.forward([utmWest, utmNorth]);
    const [lonEast, latSouth] = transformer.forward([utmEast, utmSouth]);

    const bounds: GeoBounds = {
        north: Math.max(latNorth, latSouth),
        south: Math.min(latNorth, latSouth),
        east: Math.max(lonWest, lonEast),
        west: Math.min(lonWest, lonEast)
    };

    console.log('WGS84 Bounds:', bounds);

    return bounds;
}

/**
 * Default TFW path for Ho Chi Minh DEM
 */
export const HCM_DEM_TFW_PATH = path.join(
    process.cwd(), 
    'public', 
    'HoChiMinh_DEM.tfw'
);

/**
 * Default image dimensions for the flood depth maps
 * These should match the DEM dimensions used by the AI model
 */
export const DEFAULT_IMAGE_WIDTH = 595;
export const DEFAULT_IMAGE_HEIGHT = 700;

/**
 * Get the bounds for Ho Chi Minh flood depth maps
 * Reads from TFW file if available, otherwise returns cached bounds
 */
let cachedBounds: GeoBounds | null = null;

export function getHoChiMinhBounds(): GeoBounds {
    // Return cached bounds if already calculated
    if (cachedBounds) {
        return cachedBounds;
    }

    try {
        // Try to calculate from TFW file
        cachedBounds = calculateBoundsFromTfw(
            HCM_DEM_TFW_PATH,
            DEFAULT_IMAGE_WIDTH,
            DEFAULT_IMAGE_HEIGHT
        );
        console.log('Calculated exact bounds from TFW file');
        return cachedBounds;
    } catch (error) {
        console.warn('Could not read TFW file, using fallback bounds:', error);
        
        // Fallback bounds (pre-calculated from TFW)
        cachedBounds = {
            north: 11.160447,
            south: 10.966051,
            east: 106.539889,
            west: 106.356584
        };
        return cachedBounds;
    }
}

/**
 * Clear cached bounds (useful for testing or when TFW file changes)
 */
export function clearBoundsCache(): void {
    cachedBounds = null;
}

