var Gaul = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2"),
    Plantations_kolar_2 = ee.FeatureCollection("projects/ee-mtpictd/assets/shiva/aatif/Kolar_SayTrees_2"),
    Plantations_kadiri = ee.FeatureCollection("projects/ee-aatif/assets/Plantations_Kadiri"),
    SayTrees_Neg = ee.FeatureCollection("projects/ee-mtpictd/assets/shiva/SayTrees/SayTrees_Neg"),
    SayTrees_Pos = ee.FeatureCollection("projects/ee-mtpictd/assets/shiva/sayTreesBoundary"),
    Plantations_kolar_small = ee.FeatureCollection("projects/ee-aatif/assets/Plantations_KolarSMALL"),
    saytreesIntervals = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/variables_saytrees_indiasat"),
    saytreesWeights = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/weights_saytrees_dhruvi"),
    defaultIntervals = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/variables_default_indiasat"),
    defaultWeights = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/weights_default"),
    datasets = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/datasets");




var Anantapur = Gaul.filter(ee.Filter.eq("ADM2_NAME","Anantapur"));
var Kolar = Gaul.filter(ee.Filter.eq("ADM2_NAME","Kolar"));
var countries = ee.FeatureCollection('FAO/GAUL/2015/level0');
var India = countries.filter(ee.Filter.eq('ADM0_NAME', 'India'));


var roiRaster = false; // To output a site suitability raster over the entire ROI
var annotatedPolygons = false; // To annotate each polygon with PSS, NDVI, LULC
var PSS_full_CSV = false; // To generate CSV with parameter and sublayer-wise suitability scores


var roi = Kolar;
var numLabels = 2; // Number of classification labels
var startDate = '2023-07-01';
var endDate = '2024-06-30';
var scale_Raster = 500; // scale for displaying/saving raster
var scale_Polygons = 10; // scale for aggregating PSS, NDVI at polygon level


// Import Site Suitability module
var PSS = require("users/mtpictd/anoushka:pSS_scripts/pSS_copy");
// This image has all the sublayers as bands
var PSS_rasters = PSS.getPSS(saytreesIntervals, saytreesWeights, datasets, roi, startDate, endDate, 2);
print('PSS raster:', PSS_rasters);

var proj = PSS_rasters.select('Final Score').projection();

// Print projection information
print('Projection:', proj);

// Get nominal scale (meters per pixel)
var scale = proj.nominalScale();
print('Scale (meters per pixel):', scale);


// Exports a PSS raster of the ROI
if (roiRaster) {
  
  // Export raster to Drive
  Export.image.toDrive({
    image: PSS_rasters,
    description: 'PSS_rasters',
    scale: scale_Raster,       // adjust scale according to ROI
    region: roi.geometry(),              
    maxPixels: 1e13           
  });
  
  // Display final suitability score on map
  
  // Binary classification
  if (numLabels == 2) {
    var palette = ["fe3c19", "147218"];
    var visparams = {
      "opacity": 1,
        "min": 0,
        "max": 1,
        "palette": palette
    };
    var names = ['Unsuitable', 'Suitable'];
  }
  
  // 5 labels classification
  else {
    var palette = ["147218", "8562EA", "f2fe2a", "ffac18", "fe3c19"];
    var visparams = {
      "opacity": 1,
        "min": 1,
        "max": 5,
        "palette": palette
    };
    var names = ['Very Good','Good','Moderate', 'Marginally Suitable', 'Unsuitable'];
  }

  // Set up legend
  var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px'}});
  var makeRow = function(color, name) {
        var colorBox = ui.Label({
          style: {
            backgroundColor: '#' + color,
            padding: '8px',
            margin: '0 0 4px 0'
          }
        });
   
        var description = ui.Label({
          value: name,
          style: {margin: '0 0 4px 6px'}
        });
    
        return ui.Panel({
          widgets: [colorBox, description],
          layout: ui.Panel.Layout.Flow('horizontal')
        });
  };
  
  for (var i = 0; i < numLabels; i++) {
    legend.add(makeRow(palette[i], names[i]));
    }  
  
  Map.add(legend);
  Map.addLayer(PSS_rasters.select('Final Score'), visparams, 'Final Suitability Score');
  Map.centerObject(roi.geometry(),18);
  
}

// Exports a KML or a CSV containing PSS details,
// NDVI time series and LULC analysis on polygons of ROI
if (annotatedPolygons) {
  var meanReducer = {
    reducer: ee.Reducer.mean(), 
    geometry: roi.geometry(), 
    scale: scale_Polygons, 
    maxPixels: 1e13
  };
  
  if (numLabels == 2) {
    var mapString = ee.Dictionary({0: "Unsuitable", 1:"Suitable"});
  }
  
  else if (numLabels == 5) {
    var mapString = ee.Dictionary({1: "Very Good", 2: "Good", 3: "Moderate", 4: "Marginally Suitable", 5: "Unsuitable"});
  }

  var getMaxVal = function(feature){
    // scoreClip is the final image clipped to the feature
    var scoreClip = PSS_rasters.select('Final Score').clip(feature);
    // Average over the patch
    var patch_average = ee.Number(scoreClip.reduceRegion(meanReducer).get('Final Score'));
    
    // Simple rounding off
    var patch_val = patch_average.round().int();
    
    var patch_string = mapString.get(patch_val);
    var patch_conf = patch_average;
    patch_conf = ee.Number(1).subtract(patch_average.subtract(patch_val).abs());
    scoreClip = scoreClip.set({patch_score: patch_val, patch_suitability: patch_string,
    patch_conf: patch_conf, GTscore: "-", comments: "-"});
    
    if (PSS_full_CSV) {
      
    // Process each band and attach its score to scoreClip
      var bandNames = PSS_rasters.bandNames().getInfo();
      // print(bandNames);
      var getBandVal = function(bandName) {
        if (bandName == 'Final Score') {
          return;
        }
        var band = PSS_rasters.select([bandName]).clip(feature);
        var band_average = ee.Number(band.reduceRegion(meanReducer).get('constant'));
        
        // Update scoreClip with the band score
        scoreClip = scoreClip.set(bandName, band_average);
      }
        
      bandNames.forEach(getBandVal);

    }
    
    return scoreClip;
  };
  
  var finalVec = roi.map(getMaxVal);
  
  print('finalVec:', finalVec);
  
  var NDVI = require("users/mtpictd/anoushka:pSS_scripts/NDVI_copy");
  finalVec = NDVI.getNDVI(finalVec, startDate, endDate, scale_Polygons);

  var LULC = require("users/mtpictd/anoushka:pSS_scripts/LULC_copy");
  var startYear = startDate.slice(0,4);
  var endYear = endDate.slice(0,4);
  finalVec = LULC.getLULC(finalVec, startYear, endYear, scale_Polygons);

  var finalAnnotated = finalVec.select(
    ['patch_score', 'patch_conf', 'patch_suitability', 'GTscore', 'comments',
    'LULC', 'NDVI', 'date_NDVI']);
  
  print(finalAnnotated);
  
  // // Export annotated KML
  // Export.table.toDrive({
  //   collection: finalAnnotated,
  //   description:'Plantations_Annotated',
  //   fileFormat: 'KML'
  // });
  
  // Export PSS details as CSV
  if (PSS_full_CSV) {
    finalCSV = finalVec.select(
    [
      'patch_score', 'patch_conf', 'patch_suitability', 'GTscore', 'comments', 
      'Climate_Final', 'Soil_Final', 'Topography_Final', 'Ecology_Final',
      'annualPPT', 'meanAnnualTemp', 'aridityIndex', 'refEvapTransp', 
      'T_Nutrient', 'S_Nutrient', 'Rooting_Condition', 'DRAINAGE', 'AWC',
      'T_OC', 'T_CEC', 'T_TEXTURE', 'S_OC', 'S_CEC', 'S_TEXTURE', 'T_BULK_DEN',
      'S_BULK_DEN', 'T_PH', 'S_PH', 'Elevation', 'Slope', 'Aspect', 'NDVI',
      'Forest_Cover'
    ]);
    
    print(finalCSV);
    
    Export.table.toDrive({
      collection: finalCSV,
      description:'Plantations_Details',
      fileFormat: 'CSV'
      });    
    
    }

}
