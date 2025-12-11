import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import * as geotiff from 'geotiff';
import chroma from 'chroma-js';

// Đường dẫn đến thư mục heatmaps (output PNG)
const HEATMAPS_DIR = path.join(process.cwd(), 'public', 'heatmaps');

// Đường dẫn đến thư mục chứa các file TIF theo thời gian
const TIF_SOURCE_DIR = path.join(process.cwd(), 'AIResponse');

// Đường dẫn đến file metadata
const METADATA_PATH = path.join(process.cwd(), 'AIResponse', 'metadata.json');

// Đường dẫn đến file GeoTIFF flood depths (fallback)
const FLOOD_DEPTHS_PATH = path.join(process.cwd(), 'AIResponse', 'flood_depths.tif');

// Time frame mapping: API parameter -> actual TIF filename
// Frontend sends: 'now', 'future-5', 'future-30'
const TIME_FRAME_MAP: Record<string, string> = {
    'now': 'high_0000',      // 10:05:00
    'future-5': 'high_0005',  // 10:10:00 (5 phút sau)
    'future-30': 'high_0030', // 10:15:00 (10 phút sau)
    // Legacy support
    'past-5': 'inundation_20251211_100500',
    'future-60': 'inundation_20251211_101500'
};

interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

interface FloodDepthData {
    width: number;
    height: number;
    data: Float32Array;
    bounds: Bounds;
    noDataValue?: number | undefined;
    min: number;
    max: number;
}

interface FloodDepthResult {
    success: boolean;
    data?: {
        image_url: string;
        bounds: { north: number; south: number; east: number; west: number };
        timestamp: string;
        max_depth: number;
        min_depth: number;
        legend: {
            colors: string[];
            values: number[];
        };
    };
    error?: string;
}

class FloodDepthService {
    private cachedData: FloodDepthData | null = null;

    /**
     * Đọc bounds từ metadata.json
     */
    private getMetadataBounds(): Bounds | null {
        try {
            if (!fs.existsSync(METADATA_PATH)) {
                console.warn('Metadata file not found:', METADATA_PATH);
                return null;
            }
            const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
            if (metadata.bounds) {
                return {
                    north: metadata.bounds.north,
                    south: metadata.bounds.south,
                    east: metadata.bounds.east,
                    west: metadata.bounds.west
                };
            }
        } catch (error) {
            console.warn('Error reading metadata bounds:', error);
        }
        return null;
    }

    /**
     * Đọc và parse dữ liệu GeoTIFF từ file TIF
     * @param tifPath - Đường dẫn đến file TIF cần đọc
     */
    private async readFloodDepthData(tifPath: string = FLOOD_DEPTHS_PATH): Promise<FloodDepthData> {
        try {
            console.log('Reading flood depths file:', tifPath);
            
            if (!fs.existsSync(tifPath)) {
                throw new Error(`Flood depths file not found: ${tifPath}`);
            }

            // Đọc file GeoTIFF
            const arrayBuffer = fs.readFileSync(tifPath).buffer;
            const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
            const image = await tiff.getImage();
            
            // Lấy thông tin metadata
            const width = image.getWidth();
            const height = image.getHeight();
            let bbox: number[] | null = null;

            // Một số file GeoTIFF không có affine transform → getBoundingBox ném lỗi.
            // Khi đó, dùng fallback bounds từ metadata hoặc cấu hình mặc định.
            try {
                bbox = image.getBoundingBox();
            } catch (e) {
                console.warn('⚠️ GeoTIFF missing affine transform, using fallback bounds');
                bbox = null;
            }
            
            console.log('Flood Depths GeoTIFF Info:', {
                width,
                height,
                bbox,
                fileStats: image.getFileDirectory()
            });

            // Đọc dữ liệu raster
            const rasterData = await image.readRasters();
            const data = new Float32Array(rasterData[0] as ArrayLike<number>);
            
            // Lấy giá trị NoData nếu có
            const noDataValue = image.getGDALNoData();
            console.log('NoData value:', noDataValue);

            // Tính toán min/max từ dữ liệu thực tế (bỏ qua NoData)
            let min = Infinity;
            let max = -Infinity;
            let validPixels = 0;

            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                
                // Kiểm tra giá trị tồn tại
                if (value === undefined || value === null) {
                    continue;
                }
                
                // Bỏ qua NoData values
                if (noDataValue !== null && noDataValue !== undefined && 
                    Math.abs(value - noDataValue) < 0.0001) {
                    continue;
                }
                
                // Bỏ qua các giá trị không hợp lệ
                if (!Number.isFinite(value) || Number.isNaN(value)) {
                    continue;
                }
                
                validPixels++;
                min = Math.min(min, value);
                max = Math.max(max, value);
            }

            console.log(`Valid pixels: ${validPixels}/${data.length}`);
            console.log(`Flood depth range: ${min} to ${max}`);

            // Lấy bounds từ metadata.json, nếu không có thì dùng fallback
            let bounds = this.getMetadataBounds();
            if (!bounds) {
                console.warn('⚠️ No metadata bounds found, using fallback (TP.HCM)');
                bounds = {
                    north: 11.159871119602483,
                    south: 10.375438568758025,
                    east: 107.02445924184507,
                    west: 106.35742462311387
                };
            }

            console.log('📍 Using bounds:', bounds);

            return {
                width,
                height,
                data,
                bounds,
                noDataValue: noDataValue ?? undefined,
                min: min === Infinity ? 0 : min,
                max: max === -Infinity ? 5 : max // Giả sử max depth là 5m
            };

        } catch (error) {
            console.error('Error reading flood depths GeoTIFF:', error);
            throw error;
        }
    }

    /**
     * Tạo ảnh depth map từ dữ liệu flood depths và lưu vào file
     * @param floodData - Dữ liệu flood depth
     * @param outputFilename - Tên file output (không có đuôi .png)
     */
    private async createFloodDepthImage(floodData: FloodDepthData, outputFilename: string): Promise<string> {
        const { width, height, data, noDataValue, min, max } = floodData;
        
        console.log('Generating flood depth map image:', outputFilename);
        console.log('Image dimensions:', width, 'x', height);
        console.log('Depth range:', min, 'to', max);
        
        // Tạo canvas
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Tạo color scale từ xanh lam (không ngập) đến đỏ (ngập sâu)
        const colorScale = chroma.scale(['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'])
            .domain([min, max])
            .mode('lch');
        
        // Tạo ImageData
        const imageData = ctx.createImageData(width, height);
        const pixels = imageData.data;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const value = data[index];
                const pixelIndex = index * 4;
                
                // Kiểm tra giá trị tồn tại
                if (value === undefined || value === null) {
                    pixels[pixelIndex] = 0;     // R
                    pixels[pixelIndex + 1] = 0; // G
                    pixels[pixelIndex + 2] = 0; // B
                    pixels[pixelIndex + 3] = 0; // A (transparent)
                    continue;
                }
                
                // Kiểm tra NoData values
                if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) {
                    // Trong suốt cho NoData
                    pixels[pixelIndex] = 0;     // R
                    pixels[pixelIndex + 1] = 0; // G
                    pixels[pixelIndex + 2] = 0; // B
                    pixels[pixelIndex + 3] = 0; // A (transparent)
                    continue;
                }
                
                // Kiểm tra giá trị hợp lệ
                if (!Number.isFinite(value) || Number.isNaN(value)) {
                    pixels[pixelIndex] = 0;
                    pixels[pixelIndex + 1] = 0;
                    pixels[pixelIndex + 2] = 0;
                    pixels[pixelIndex + 3] = 0;
                    continue;
                }
                
                // Nếu giá trị = 0 (không ngập), làm trong suốt
                if (value === 0) {
                    pixels[pixelIndex] = 0;
                    pixels[pixelIndex + 1] = 0;
                    pixels[pixelIndex + 2] = 0;
                    pixels[pixelIndex + 3] = 0;
                    continue;
                }
                
                // Chuyển đổi giá trị thành màu
                const color = colorScale(value).rgb();
                
                pixels[pixelIndex] = color[0];     // R
                pixels[pixelIndex + 1] = color[1]; // G
                pixels[pixelIndex + 2] = color[2]; // B
                pixels[pixelIndex + 3] = 180;      // A (70% opacity)
            }
        }
        
        // Vẽ lên canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Sử dụng tên file được truyền vào
        const filename = `${outputFilename}.png`;
        
        // Đảm bảo thư mục heatmaps tồn tại
        if (!fs.existsSync(HEATMAPS_DIR)) {
            fs.mkdirSync(HEATMAPS_DIR, { recursive: true });
        }
        
        // Lưu file
        const filePath = path.join(HEATMAPS_DIR, filename);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(filePath, buffer);
        
        console.log('Flood depth map image saved to:', filePath);
        return `/heatmaps/${filename}`;
    }

    /**
     * Lấy depth map theo time frame
     * @param timeFrame - 'now' | 'future-5' | 'future-30'
     */
    public async getFloodDepthMap(timeFrame: string = 'now'): Promise<FloodDepthResult> {
        try {
            // Map time frame to actual TIF filename
            const tifBasename = TIME_FRAME_MAP[timeFrame] || 'inundation_20251211_100500';
            const tifPath = path.join(TIF_SOURCE_DIR, `${tifBasename}.tif`);
            
            console.log(`🔍 Looking for TIF file: ${tifPath}`);
            
            // Check if source TIF exists
            if (!fs.existsSync(tifPath)) {
                throw new Error(`Source TIF file not found: ${tifPath}`);
            }
            
            // PNG output filename
            const pngFilename = `${tifBasename}`;
            const pngPath = path.join(HEATMAPS_DIR, `${pngFilename}.png`);
            
            console.log(`🖼️ PNG output: ${pngPath}`);
            
            // Check if PNG already exists
            if (fs.existsSync(pngPath)) {
                console.log(`✅ Found existing PNG: ${pngFilename}.png`);
                
                // Read TIF file for metadata (bounds, min/max)
                let minDepth = 0;
                let maxDepth = 5;
                let bounds: Bounds = this.getMetadataBounds() || {
                    north: 16.5,
                    south: 16.4,
                    east: 107.65,
                    west: 107.55
                };
                
                // Try to get min/max from TIF file
                if (fs.existsSync(tifPath)) {
                    try {
                        const tifData = await this.readFloodDepthData(tifPath);
                        minDepth = tifData.min;
                        maxDepth = tifData.max;
                        // Bounds từ metadata, không từ TIF
                        console.log(`📊 TIF Stats - Min: ${minDepth}, Max: ${maxDepth}`);
                    } catch (e) {
                        console.warn('Could not read TIF metadata, using defaults:', e);
                    }
                }
                
                // Generate legend values
                const legendValues = [
                    minDepth,
                    minDepth + (maxDepth - minDepth) * 0.25,
                    minDepth + (maxDepth - minDepth) * 0.5,
                    minDepth + (maxDepth - minDepth) * 0.75,
                    maxDepth
                ];
                
                return {
                    success: true,
                    data: {
                        image_url: `/heatmaps/${pngFilename}.png`,
                        bounds: bounds,
                        timestamp: new Date().toISOString(),
                        max_depth: maxDepth,
                        min_depth: minDepth,
                        legend: {
                            colors: ['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'],
                            values: legendValues
                        },
                        timeFrame: timeFrame,
                        sourceTif: tifBasename
                    }
                };
            }
            
            // Generate PNG from TIF
            console.log(`🎨 Generating PNG from TIF: ${tifBasename}`);
            
            // Load dữ liệu từ TIF file cụ thể
            const floodData = await this.readFloodDepthData(tifPath);
            
            // Tạo ảnh depth map với tên file cụ thể
            const imageUrl = await this.createFloodDepthImage(floodData, pngFilename);
            
            // Tạo legend values (5 mức)
            const legendValues = [
                floodData.min,
                floodData.min + (floodData.max - floodData.min) * 0.25,
                floodData.min + (floodData.max - floodData.min) * 0.5,
                floodData.min + (floodData.max - floodData.min) * 0.75,
                floodData.max
            ];

            console.log(`✅ PNG generated successfully: ${imageUrl}`);
            
            return {
                success: true,
                data: {
                    image_url: imageUrl,
                    bounds: floodData.bounds,
                    timestamp: new Date().toISOString(),
                    max_depth: floodData.max,
                    min_depth: floodData.min,
                    legend: {
                        colors: ['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'],
                        values: legendValues
                    },
                    timeFrame: timeFrame,
                    sourceTif: tifBasename
                }
            };

        } catch (error: any) {
            console.error('Error in getFloodDepthMap:', error);
            return {
                success: false,
                error: error.message || 'Failed to generate flood depth map'
            };
        }
    }
    
    /**
     * Get min/max stats from a TIF file
     */
    private async getTifStats(tifPath: string): Promise<{ min: number; max: number }> {
        const arrayBuffer = fs.readFileSync(tifPath).buffer;
        const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasterData = await image.readRasters();
        const data = new Float32Array(rasterData[0] as ArrayLike<number>);
        const noDataValue = image.getGDALNoData();
        
        let min = Infinity;
        let max = -Infinity;
        
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (value === undefined || value === null) continue;
            if (noDataValue !== null && noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
            if (!Number.isFinite(value) || Number.isNaN(value)) continue;
            if (value === 0) continue;
            
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        
        return {
            min: min === Infinity ? 0 : min,
            max: max === -Infinity ? 5 : max
        };
    }

    /**
     * Tính độ ngập trung bình cho một vùng được chọn
     * @param bounds - Vùng cần phân tích
     * @param timeFrame - Time frame để chọn file TIF (optional)
     */
    public async getRegionFloodDepth(bounds: Bounds, timeFrame: string = 'now'): Promise<any> {
        try {
            // Load dữ liệu từ TIF file theo timeFrame
            const tifBasename = TIME_FRAME_MAP[timeFrame] || 'inundation_20251211_100500';
            const tifPath = path.join(TIF_SOURCE_DIR, `${tifBasename}.tif`);
            
            const floodData = fs.existsSync(tifPath) 
                ? await this.readFloodDepthData(tifPath)
                : await this.readFloodDepthData(FLOOD_DEPTHS_PATH);
                
            const { data, bounds: tifBounds, width, height, noDataValue } = floodData;

            // Convert lat/lng bounds to pixel coordinates
            const latRange = tifBounds.north - tifBounds.south;
            const lngRange = tifBounds.east - tifBounds.west;

            // Calculate pixel boundaries for the selected region
            const pixelNorth = Math.floor(((tifBounds.north - bounds.north) / latRange) * height);
            const pixelSouth = Math.ceil(((tifBounds.north - bounds.south) / latRange) * height);
            const pixelWest = Math.floor(((bounds.west - tifBounds.west) / lngRange) * width);
            const pixelEast = Math.ceil(((bounds.east - tifBounds.west) / lngRange) * width);

            // Clamp to image bounds
            const startY = Math.max(0, Math.min(pixelNorth, pixelSouth));
            const endY = Math.min(height, Math.max(pixelNorth, pixelSouth));
            const startX = Math.max(0, Math.min(pixelWest, pixelEast));
            const endX = Math.min(width, Math.max(pixelWest, pixelEast));

            console.log('Region analysis:', {
                selectedBounds: bounds,
                tifBounds,
                pixelRegion: { startX, endX, startY, endY },
                imageSize: { width, height }
            });

            // Extract flood depth values from the selected region
            const regionValues: number[] = [];
            let totalPixels = 0;

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = y * width + x;
                    const value = data[index];
                    totalPixels++;

                    // Skip invalid values
                    if (value === undefined || value === null) continue;
                    if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
                    if (!Number.isFinite(value) || Number.isNaN(value)) continue;

                    regionValues.push(value);
                }
            }

            if (regionValues.length === 0) {
                return {
                    success: true,
                    data: {
                        region_bounds: bounds,
                        total_pixels: totalPixels,
                        valid_pixels: 0,
                        average_depth: 0,
                        max_depth: 0,
                        min_depth: 0,
                        message: 'No valid flood data found in selected region'
                    }
                };
            }

            // Calculate statistics
            const avgDepth = regionValues.reduce((sum, val) => sum + val, 0) / regionValues.length;
            const maxDepth = Math.max(...regionValues);
            const minDepth = Math.min(...regionValues);

            // Classify flood levels
            const noFlood = regionValues.filter(v => v === 0).length;
            const shallow = regionValues.filter(v => v > 0 && v <= 0.5).length;
            const moderate = regionValues.filter(v => v > 0.5 && v <= 1.0).length;
            const deep = regionValues.filter(v => v > 1.0 && v <= 2.0).length;
            const veryDeep = regionValues.filter(v => v > 2.0).length;

            const validPixels = regionValues.length;

            return {
                success: true,
                data: {
                    region_bounds: bounds,
                    total_pixels: totalPixels,
                    valid_pixels: validPixels,
                    coverage_percentage: (validPixels / totalPixels) * 100,
                    average_depth: Number(avgDepth.toFixed(3)),
                    max_depth: Number(maxDepth.toFixed(3)),
                    min_depth: Number(minDepth.toFixed(3)),
                    flood_distribution: {
                        no_flood: { count: noFlood, percentage: (noFlood / validPixels) * 100 },
                        shallow: { count: shallow, percentage: (shallow / validPixels) * 100 },
                        moderate: { count: moderate, percentage: (moderate / validPixels) * 100 },
                        deep: { count: deep, percentage: (deep / validPixels) * 100 },
                        very_deep: { count: veryDeep, percentage: (veryDeep / validPixels) * 100 }
                    },
                    pixel_coordinates: {
                        start_x: startX,
                        end_x: endX,
                        start_y: startY,
                        end_y: endY
                    }
                }
            };

        } catch (error: any) {
            console.error('Error analyzing region flood depth:', error);
            return {
                success: false,
                error: error.message || 'Failed to analyze region flood depth'
            };
        }
    }

    /**
     * Lấy dữ liệu thống kê về flood depths
     * @param timeFrame - Time frame để lấy stats (optional)
     */
    public async getFloodDepthStats(timeFrame: string = 'now'): Promise<any> {
        try {
            // Load dữ liệu từ TIF file theo timeFrame
            const tifBasename = TIME_FRAME_MAP[timeFrame] || 'inundation_20251211_100500';
            const tifPath = path.join(TIF_SOURCE_DIR, `${tifBasename}.tif`);
            
            const floodData = fs.existsSync(tifPath) 
                ? await this.readFloodDepthData(tifPath)
                : await this.readFloodDepthData(FLOOD_DEPTHS_PATH);
                
            const { data, noDataValue, min, max, width, height } = floodData;

            // Thu thập các giá trị hợp lệ
            const validValues: number[] = [];
            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                
                if (value === undefined || value === null) continue;
                if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
                if (!Number.isFinite(value) || Number.isNaN(value)) continue;
                
                validValues.push(value);
            }

            // Phân loại theo độ ngập
            const noFlood = validValues.filter(v => v === 0);
            const shallow = validValues.filter(v => v > 0 && v <= 0.5);
            const moderate = validValues.filter(v => v > 0.5 && v <= 1);
            const deep = validValues.filter(v => v > 1 && v <= 2);
            const veryDeep = validValues.filter(v => v > 2);

            const totalValid = validValues.length;

            return {
                success: true,
                data: {
                    total_pixels: width * height,
                    valid_pixels: totalValid,
                    min_depth: min,
                    max_depth: max,
                    average_depth: validValues.reduce((a, b) => a + b, 0) / totalValid,
                    depth_distribution: {
                        no_flood: { count: noFlood.length, percentage: (noFlood.length / totalValid) * 100 },
                        shallow: { count: shallow.length, percentage: (shallow.length / totalValid) * 100 },
                        moderate: { count: moderate.length, percentage: (moderate.length / totalValid) * 100 },
                        deep: { count: deep.length, percentage: (deep.length / totalValid) * 100 },
                        very_deep: { count: veryDeep.length, percentage: (veryDeep.length / totalValid) * 100 }
                    }
                }
            };

        } catch (error: any) {
            console.error('Error getting flood depth stats:', error);
            return {
                success: false,
                error: error.message || 'Failed to get flood depth statistics'
            };
        }
    }
}

const floodDepthService = new FloodDepthService();
export default floodDepthService;