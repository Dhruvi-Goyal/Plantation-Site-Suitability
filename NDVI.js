
// var roi_boundary = 
//   ee.Image("projects/df-project-iit/assets/core-stack/odisha/kalahandi/bhawanipatna/kalahandi_bhawanipatna_2023-07-01_2024-06-30_LULCmap_10m")
//   .geometry();

// var roi_string = "projects/ee-corestackdev/assets/apps/plantation/cfpt/infosys/CFPT_Infosys";
// var roi_boundary = ee.FeatureCollection(roi_string).geometry();

// // Set start and end dates
var startDate = '2017-07-01';
var endDate = '2023-06-30';


var getNDVI = function(features, startDate, endDate, scale) {

// exports.getNDVI = function(features, startDate, endDate, scale) {
  var NDVI = require("users/mtpictd/anoushka:pSS_scripts/ndvi_harmonize");
  var ndviCollection = NDVI.harmonizedNDVI(startDate, endDate, features.geometry());
  var ndviFeatures = features.map(function(feature) {
    var ndviSeries = ndviCollection.map(function(image) {
      var meanNDVI = image.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: feature.geometry(),
        scale: scale
      }).get('gapfilled_NDVI_lsc');
      var dateStr = image.date().format('YYYY-MM-dd');
      
      var tempDict = ee.Dictionary({ 
        'NDVI': ee.Algorithms
              .If(ee.Algorithms.IsEqual(meanNDVI, null), -9999, meanNDVI),
        'date' : dateStr
        });
      return ee.Feature(null, tempDict);
    });
    var ndviList = ndviSeries.aggregate_array('NDVI');
    var dateList = ndviSeries.aggregate_array('date');
    return feature.set({NDVI: ndviList, date_NDVI: dateList });
  });
  
  return ndviFeatures;
}

var saytreesNeg = ee.FeatureCollection('projects/ee-mtpictd/assets/shiva/SayTrees/SayTrees_Neg');
var roi = ee.FeatureCollection([saytreesNeg.toList(saytreesNeg.size()).get(2)]);
var res = getNDVI(roi, startDate, endDate, 10).select(['NDVI', 'date_NDVI']);
print(res);

// var featureCollection = ee.FeatureCollection([res.select(['NDVI', 'date_NDVI'])]);
// print(featureCollection)

// Export the FeatureCollection 
Export.table.toDrive({
  collection: res,
  description: 'NDVI_SayTrees_Neg',
  fileFormat: 'CSV'
});


// var features = ee.FeatureCollection(roi_string);
// var res = getNDVI(features, startDate, endDate, 10);
// print(res);

// // Export the FeatureCollection 
// Export.table.toAsset({
//   assetId: 'projects/ee-mtpictd/assets/anoushka/ndvi', 
//   collection: res,
//   description: 'ndvi',
// });


// var image = ee.Image(res.first());
// var bandProjection = image.projection();

// // Print projection information
// print('Projection:', bandProjection);
// print('Nominal Scale (in meters):', bandProjection.nominalScale());


// var polygon = ee.Feature(roi.toList(6).get(1));
// var res = getNDVI(polygon);

// print(ndvi.filterBounds(polygon.geometry()));
// print(res);

// // Load your NDVI image (replace 'YOUR_IMAGE' with your actual image ID or variable)
// var ndviImage = ee.Image(ndvi.toList(ndvi.size()).get(26)).clip(polygon.geometry());

// ndviImage = ndviImage.updateMask(ndviImage.select('NDVI'))

// // Define visualization parameters
// var ndviVis = {
//   min: -1,     // Minimum NDVI value
//   max: 1,      // Maximum NDVI value
//   palette: [
//     // 'white',    // Very low NDVI
//     'red'    // High NDVI
//   ]
// };

// // Add the NDVI image layer to the map with the visualization parameters
// Map.centerObject(ndviImage, 18);  // Adjust zoom level as needed
// Map.addLayer(ndviImage, ndviVis, 'NDVI Image');
// Map.addLayer(polygon.geometry(), {}, "Boundary");


// var featureCollection = ee.FeatureCollection([res.select(['NDVI', 'date_NDVI'])]);
// // var ndviTimeSeries = roi.map(getNDVI);
// // print(ndviTimeSeries);




