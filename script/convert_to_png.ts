import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import * as geotiff from 'geotiff';
import chroma from 'chroma-js';

/**
 * Convert a GeoTIFF flood depth file to PNG heatmap image
 */
async function convertTifToPng(inputPath: string, outputPath: string): Promise<void> {
    console.log(`\n=== Converting: ${path.basename(inputPath)} ===`);
    
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
    }

    // Read GeoTIFF
    console.log('Reading GeoTIFF...');
    const arrayBuffer = fs.readFileSync(inputPath).buffer;
    const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    
    const width = image.getWidth();
    const height = image.getHeight();
    const noDataValue = image.getGDALNoData();
    
    console.log(`Dimensions: ${width} x ${height}`);
    console.log(`NoData value: ${noDataValue}`);
    
    // Read raster data
    const rasterData = await image.readRasters();
    const data = new Float32Array(rasterData[0] as ArrayLike<number>);
    
    // Calculate min/max (excluding NoData)
    let min = Infinity;
    let max = -Infinity;
    let validPixels = 0;
    
    for (let i = 0; i < data.length; i++) {
        const value = data[i];
        
        if (value === undefined || value === null) continue;
        if (noDataValue !== null && noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
        if (!Number.isFinite(value) || Number.isNaN(value)) continue;
        if (value === 0) continue; // Skip zero values for range calculation
        
        validPixels++;
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    
    // Default range if no valid data
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 5;
    
    console.log(`Valid flooded pixels: ${validPixels}`);
    console.log(`Depth range: ${min.toFixed(3)}m to ${max.toFixed(3)}m`);
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Color scale: blue (shallow) -> cyan -> green -> yellow -> red (deep)
    const colorScale = chroma.scale(['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'])
        .domain([min, max])
        .mode('lch');
    
    // Create image data
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const value = data[index];
            const pixelIndex = index * 4;
            
            // Check for invalid values
            if (value === undefined || value === null) {
                pixels[pixelIndex] = 0;
                pixels[pixelIndex + 1] = 0;
                pixels[pixelIndex + 2] = 0;
                pixels[pixelIndex + 3] = 0; // Transparent
                continue;
            }
            
            // Check NoData values
            if (noDataValue !== null && noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) {
                pixels[pixelIndex] = 0;
                pixels[pixelIndex + 1] = 0;
                pixels[pixelIndex + 2] = 0;
                pixels[pixelIndex + 3] = 0; // Transparent
                continue;
            }
            
            // Check invalid numbers
            if (!Number.isFinite(value) || Number.isNaN(value)) {
                pixels[pixelIndex] = 0;
                pixels[pixelIndex + 1] = 0;
                pixels[pixelIndex + 2] = 0;
                pixels[pixelIndex + 3] = 0;
                continue;
            }
            
            // Zero depth = no flooding = transparent
            if (value === 0) {
                pixels[pixelIndex] = 0;
                pixels[pixelIndex + 1] = 0;
                pixels[pixelIndex + 2] = 0;
                pixels[pixelIndex + 3] = 0;
                continue;
            }
            
            // Apply color based on depth value
            const color = colorScale(value).rgb();
            pixels[pixelIndex] = color[0];     // R
            pixels[pixelIndex + 1] = color[1]; // G
            pixels[pixelIndex + 2] = color[2]; // B
            pixels[pixelIndex + 3] = 180;      // A (70% opacity)
        }
    }
    
    // Draw to canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Save as PNG
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    
    const fileSizeKB = (buffer.length / 1024).toFixed(1);
    console.log(`✓ Saved: ${outputPath} (${fileSizeKB} KB)`);
}

/**
 * Main function - convert all TIF files in heatmaps folder
 */
async function main() {
    const heatmapsDir = path.join(process.cwd(), 'public', 'heatmaps');
    
    console.log('='.repeat(60));
    console.log('TIF to PNG Converter for Flood Depth Maps');
    console.log('='.repeat(60));
    console.log(`Source directory: ${heatmapsDir}`);
    
    // Find all TIF files
    const files = fs.readdirSync(heatmapsDir);
    const tifFiles = files.filter(f => f.endsWith('.tif'));
    
    console.log(`\nFound ${tifFiles.length} TIF file(s):`);
    tifFiles.forEach(f => console.log(`  - ${f}`));
    
    // Convert each TIF file
    for (const tifFile of tifFiles) {
        const inputPath = path.join(heatmapsDir, tifFile);
        const outputPath = path.join(heatmapsDir, tifFile.replace('.tif', '.png'));
        
        try {
            await convertTifToPng(inputPath, outputPath);
        } catch (error: any) {
            console.error(`✗ Error converting ${tifFile}:`, error.message);
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Conversion complete!');
    console.log('='.repeat(60));
}

// Run
main().catch(console.error);
