
var roi = ee.FeatureCollection("projects/ee-mtpictd/assets/shiva/SayTrees/SayTrees_Neg");
var Gaul = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2");
var anantapur = Gaul.filter(ee.Filter.eq("ADM2_NAME","Anantapur"));


exports.getLULC = function(features, startYear, endYear, scale) {

  // Convert to numbers
  var start = parseInt(startYear, 10);
  var end = parseInt(endYear, 10) - 1;

  var LULC_years = {};
  for (var year = start; year <= end; year++) {
    var nextYear = year + 1;
    var assetId = 'projects/ee-corestackdev/assets/datasets/LULC_v3_river_basin/pan_india_lulc_v3_' +
                  year + '_' + nextYear;
    
    var LULC_img = ee.Image(assetId).select('predicted_label').clip(features.geometry());
        LULC_years[year] = LULC_img;
  }
  
  var LULC_years_dict = ee.Dictionary(LULC_years);

  var lulcFeatures = features.map(function(feature) {
    
    var LULCByYear = LULC_years_dict.keys().map(function(year) {
      // Get the image for the current year
      var annualLULC = ee.Image(LULC_years_dict.get(year)).select('predicted_label');
    
      // Perform the histogram reduction
      var lulcHistogram = annualLULC.reduceRegion({
        reducer: ee.Reducer.frequencyHistogram(),
        geometry: feature.geometry(),
        scale: scale,
        bestEffort: true
      });
    
      // Get the histogram and modify the values to get in hectares
      var tempDict = ee.Dictionary(lulcHistogram.get('predicted_label'));
      tempDict = tempDict.map(function(key, value) {
        return ee.Number(value).multiply(0.01).multiply(1000).round().divide(1000);
      });
    
      // Combine the year with the histogram data
      var lulcDict = ee.Dictionary({'year': year});
      lulcDict = lulcDict.combine(tempDict);
    
      return lulcDict;
    });
  
    return feature.set('LULC', LULCByYear);
    
  });
  
  return lulcFeatures;
};



// var LULCseries = getLULC(roi, '2020', '2024', 10);
// print(LULCseries);

// var polygon = ee.Feature(roi.toList(6).get(3));
// var res = getLULC(polygon, '2017', '2023', 30);
// print(res);

// var featureCollection = ee.FeatureCollection([res.select(['LULC'])]);
// print(featureCollection);

// // Export the FeatureCollection 
// Export.table.toDrive({
//   collection: featureCollection,
//   description: 'LULC_SayTrees',
//   fileFormat: 'CSV'
// });


