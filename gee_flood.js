ui.root.clear();
var map = ui.Map();
var GRAYMAP = [
    {
        stylers: [{ saturation: -100 }]
    }, {
        elementType: 'labels',
        stylers: [{ lightness: 50 }]
    }, {
        featureType: 'road',
        elementType: 'geometry',
        stylers: [{ visibility: 'simplified' }]
    }, {
        featureType: 'road',
        elementType: 'labels',
        stylers: [{ visibility: 'off' }]
    }, {
        elementType: 'labels.icon',
        stylers: [{ visibility: 'off' }]
    }, {
        featureType: 'poi',
        elementType: 'all',
        stylers: [{ visibility: 'off' }]
    }
];

ui.root.add(map);
map.setOptions('TERRAIN');
map.setOptions('Gray', { 'Gray': GRAYMAP });
map.setGestureHandling('greedy');

// Create UI Panel for Buttons
var controlPanel = ui.Panel({
    style: { width: '300px', padding: '8px' }
});
ui.root.add(controlPanel);

// Add Title to Control Panel
controlPanel.add(ui.Label({
    value: 'วิเคราะห์พื้นที่น้ำท่วม',
    style: { fontSize: '20px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));

controlPanel.add(ui.Label({
    value: '1. วาดพื้นที่ที่ต้องการลงบนแผนที่',
    style: { fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));

var before_start;
var before_end;
var beforeDateSlider = ui.DateSlider({
    start: '2020-01-01',
    // end: '2024-05-24',
    value: '2024-05-01',
    period: 14,
    onChange: function (dateRange) {
        before_start = dateRange.start();
        before_end = dateRange.end();
    }
});

var after_start;
var after_end;
var afterDateSlider = ui.DateSlider({
    start: '2020-01-01',
    // end: '2024-10-10',
    value: '2024-10-01',
    period: 14,
    onChange: function (dateRange) {
        after_start = dateRange.start();
        after_end = dateRange.end();

        print(after_start, after_end);
    }
});

controlPanel.add(ui.Label({
    value: '2. เลือกช่วงเวลาก่อนน้ำท่วม',
    style: { fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));
controlPanel.add(ui.Label('Before Flood Date Range:'));
controlPanel.add(beforeDateSlider);

controlPanel.add(ui.Label({
    value: '3. เลือกช่วงเวลาหลังน้ำท่วม',
    style: { fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));
controlPanel.add(ui.Label('After Flood Date Range:'));
controlPanel.add(afterDateSlider);

var geometry;

function runFlood(geometry) {
    drawingTools.setLinked(false);

    // Clear previous layers from the map
    map.layers().reset();

    // กำหนดขอบเขตพื้นที่ศึกษาโดยการวาด
    var aoi = ee.FeatureCollection(geometry);

    // กำหนดช่วงเวลาก่อนน้ำท่วม

    before_start = beforeDateSlider.getValue()[0];
    before_end = beforeDateSlider.getValue()[1];
    // กำหนดช่วงเวลาหลังน้ำท่วม
    after_start = afterDateSlider.getValue()[0];
    after_end = afterDateSlider.getValue()[1];

    print(ee.Date(before_start), ee.Date(before_end));
    print(ee.Date(after_start), ee.Date(after_end));

    // เลือกประเภทของข้อมูล
    var polarization = "VH"; // 'VV'  'VH' 
    var pass_direction = "DESCENDING"; // 'DESCENDING' หรือ 'ASCENDING'

    // Load and filter Sentinel-1 GRD  
    var collection = ee.ImageCollection('COPERNICUS/S1_GRD')
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', polarization))
        .filter(ee.Filter.eq('orbitProperties_pass', pass_direction))
        .filter(ee.Filter.eq('resolution_meters', 10))
        .filterBounds(aoi)
        .select(polarization);

    // Filter date
    var before_collection = collection.filterDate(ee.Date(before_start), ee.Date(before_end));
    var after_collection = collection.filterDate(ee.Date(after_start), ee.Date(after_end));

    // clip กับพื้นที่ศึกษา
    var before = before_collection.mosaic().clip(aoi);
    var after = after_collection.mosaic().clip(aoi);

    // ปรับให้ภาพ smooth 
    var smoothing_radius = 25;
    var before_filtered = before.focal_mean(smoothing_radius, 'circle', 'meters');
    var after_filtered = after.focal_mean(smoothing_radius, 'circle', 'meters');

    // วิเคราะห์ความแตกต่างของข้อมูลการสะท้อนใน 2 ช่วงเวลา
    var difference_threshold = -5.5;
    var difference_db = after_filtered.subtract(before_filtered);
    var difference_binary = difference_db.lte(difference_threshold);
    var flood_raw_mask = difference_db.updateMask(difference_binary);

    // นำข้อมูลอื่นมาช่วยลบข้อมูล
    var swater = ee.Image('JRC/GSW1_0/GlobalSurfaceWater').select('seasonality');
    var swater_mask = swater.gte(5).updateMask(swater.gte(5));
    var flooded_mask = difference_binary.where(swater_mask, 0);
    var flooded = flooded_mask.updateMask(flooded_mask);
    var connections = flooded.connectedPixelCount();
    flooded = flooded.updateMask(connections.gte(8));
    var dem = ee.Image('WWF/HydroSHEDS/03VFDEM');
    var terrain = ee.Algorithms.Terrain(dem);
    var slope = terrain.select('slope');
    flooded = flooded.updateMask(slope.lt(5));

    // Add layers to map
    map.centerObject(aoi);
    map.addLayer(before_filtered, { min: -25, max: 0 }, 'Before Flood', false, 0.6);
    map.addLayer(after_filtered, { min: -25, max: 0 }, 'After Flood', true, 0.6);
    map.addLayer(difference_db, { min: -5, max: 5 }, 'Difference (dB)', false, 0.6);
    map.addLayer(flood_raw_mask, { palette: 'blue' }, 'Flooded (raw)', false, 0.6);
    map.addLayer(flooded, { palette: 'blue' }, 'Flooded Areas', true, 1);

    drawingTools.layers().reset();
}

// Create a Legend for Flooded Areas
var legendPanel = ui.Panel({
    style: { position: 'bottom-right', padding: '8px', width: '150px' }
});

legendPanel.add(ui.Label({
    value: 'Legend',
    style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0' }
}));

var legendPanel = ui.Panel({
    style: { position: 'bottom-right', padding: '8px', width: '150px' }
});
legendPanel.add(ui.Label({
    value: 'Legend',
    style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0' }
}));

var floodLegend = ui.Panel({
    widgets: [
        ui.Label('', {
            backgroundColor: 'blue',
            padding: '8px',
            margin: '0 0 4px 0'
        }),
        ui.Label('Flooded Areas', { margin: '0 0 4px 6px' })
    ],
    layout: ui.Panel.Layout.flow('horizontal')
});


legendPanel.add(floodLegend);
map.add(legendPanel);

var drawingTools = map.drawingTools();
drawingTools.setShown(true);
drawingTools.setShape('rectangle');
drawingTools.setLinked(false);

map.setCenter(98.993, 18.708, 10);

drawingTools.onDraw(function () {
    geometry = drawingTools.layers().get(0).getEeObject();
    map.centerObject(geometry);
    // print('Drawn Geometry:', geometry);  
    // runFlood(geometry);  
});

var runButton = ui.Button({
    label: 'Run',
    onClick: function () {
        if (geometry) {
            runFlood(geometry);
        } else {
            ui.notify('Please draw an area first.', 'warning');
        }
    }
});

var clearButton = ui.Button({
    label: 'Clear',
    onClick: function () {
        map.layers().reset();
        drawingTools.layers().reset();
        geometry = null;
    }
});

controlPanel.add(ui.Label({
    value: '4. คำนวณพื้นที่น้ำท่วม',
    style: { fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));
controlPanel.add(runButton);

controlPanel.add(ui.Label({
    value: '5. clear',
    style: { fontSize: '16px', fontWeight: 'bold', margin: '0 0 8px 5px ' }
}));
controlPanel.add(clearButton);