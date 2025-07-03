
//=============== INPUTS =======================//


// CSV mapping a variable to its labels and specifying weights
var specificInfo = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/variables_saytrees_indiasat");
var specificWeights = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/weights_saytrees_dhruvi");

// CSV mapping a variable/roi to its dataset
var datasets = ee.FeatureCollection("projects/ee-mtpictd/assets/anoushka/pss_inputs/datasets");
 
var roi_path = datasets.filter(ee.Filter.eq('name', 'roi')).first().get('path').getInfo();
// var roi = ee.FeatureCollection(roi_path);
// var Gaul = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2");
// var roi = Gaul.filter(ee.Filter.eq("ADM2_NAME","Kolar"));
var SayTrees_Neg = ee.FeatureCollection("projects/ee-mtpictd/assets/shiva/SayTrees/SayTrees_Neg");
var roi = SayTrees_Neg.first();


//=============== SET UP AND HELPER FUNCTIONS =======================//


// Plots and prints histogram
function plotHistogram(image, name) {
  var histogram = image.reduceRegion({
    reducer: ee.Reducer.histogram(),
    geometry: roi.geometry(),
    scale: 30, 
    maxPixels: 1e9
  });
  
  print(histogram);
  
  var histogramDict = ee.Dictionary(histogram.get(name));
  // print('Histogram:', imageHistogram);
  
  // Plot the histogram using ui.Chart
  var chart = ui.Chart.array.values({
    array: histogramDict.get('histogram'),
    axis: 0,
    xLabels: histogramDict.get('bucketMeans')
  }).setOptions({
    title: name,
    hAxis: {title: 'Values'},
    vAxis: {title: 'Frequency'},
    lineWidth: 0.3,
    pointSize: 0.3
  });
  
  // Display the chart
  print(chart);
}

// Extracts the dataset image for a given variable using its path in datasetPaths
function getDataset(variable, datasetPaths, startDate, endDate) {

  // These variables have datasets that need preprocessing before the image can be classified
  // E.g. slope has to be extracted from the SRTDEM dataset using Terrain.slope()
  var diffVariables = ['distToRoad', 'distToDrainage', 'distToSettlements', 'slope', 'aspect', 'NDVI', 'LULC'];
  
  // If a variable needs special handling
  if (diffVariables.indexOf(variable) !== -1) {
    if (variable === 'slope') {
      var path = datasetPaths.filter(ee.Filter.eq('name', variable)).first().get('path').getInfo();
      var dataset = ee.Image(path);
      return ee.Terrain.slope(dataset); // Units are degrees, range is [0,90)
    }
    
    else if (variable === 'aspect') {
      var path = datasetPaths.filter(ee.Filter.eq('name', variable)).first().get('path').getInfo();
      var dataset = ee.Image(path);
      return ee.Terrain.aspect(dataset);
    }
    // LULC has been updated - note that scale is hardcoded
    else if (variable === 'LULC') {
      var start = parseInt(startDate.slice(0,4), 10);
      var end = parseInt(endDate.slice(0,4), 10) - 1;
      
      var LULC_years = [];
      for (var year = start; year <= end; year++) {
        var nextYear = year + 1;
        var assetId = 'projects/ee-corestackdev/assets/datasets/LULC_v3_river_basin/pan_india_lulc_v3_' +
                      year + '_' + nextYear;
        
        var LULC_img = ee.Image(assetId).select('predicted_label').clip(roi.geometry());
            LULC_years.push(LULC_img);
      }
      
      var lulcCollection = ee.ImageCollection(LULC_years);
      return lulcCollection.mode().reproject({ crs: 'EPSG:4326', scale: 10  });
      
    }
    
    // NDVI has been updated
    else if (variable === 'NDVI') {
      var NDVI = require("users/mtpictd/anoushka:pSS_scripts/ndvi_harmonize");
      var ndviCollection = NDVI.harmonizedNDVI(startDate, endDate, roi.geometry());
      return ndviCollection.select('gapfilled_NDVI_lsc').reduce(ee.Reducer.mean())
                           .reproject({ crs: 'EPSG:4326', scale: 10  });
    }
    
    // Make this pan-India, current dataset is only Tamil Nadu
    else if (variable === 'distToRoad') {
      var path = datasetPaths.filter(ee.Filter.eq('name', variable)).first().get('path').getInfo();
      var datasetCollection = ee.FeatureCollection(path);
      var dataset = datasetCollection.reduceToImage({
            properties: ['STATE_ID'],
            reducer: ee.Reducer.first()
      });
      return dataset.fastDistanceTransform().sqrt().multiply(ee.Image.pixelArea().sqrt())
                    .reproject({ crs: 'EPSG:4326',  scale: 330 });
    }   

    else if (variable === 'distToDrainage') {
      var path = datasetPaths.filter(ee.Filter.eq('name', variable)).first().get('path').getInfo();
      var dataset = ee.Image(path);
      var strahler3to7 = dataset.select('b1').lte(7).and(dataset.select('b1').gt(2));
      return strahler3to7.fastDistanceTransform().sqrt().multiply(ee.Image.pixelArea().sqrt());
    } 
    // LULC has been updated
    else if (variable === 'distToSettlements') {
      var start = parseInt(startDate.slice(0,4), 10);
      var end = parseInt(endDate.slice(0,4), 10) - 1;
      
      var LULC_years = [];
      for (var year = start; year <= end; year++) {
        var nextYear = year + 1;
        var assetId = 'projects/ee-corestackdev/assets/datasets/LULC_v3_river_basin/pan_india_lulc_v3_' +
                      year + '_' + nextYear;
        
        var LULC_img = ee.Image(assetId).select('predicted_label').clip(roi.geometry());
            LULC_years.push(LULC_img);
      }
      
      var lulcCollection = ee.ImageCollection(LULC_years);
      var LULC = lulcCollection.mode();
      
      return LULC.eq(1).fastDistanceTransform().sqrt().multiply(ee.Image.pixelArea().sqrt())
                 .reproject({ crs: 'EPSG:4326', scale: 10  });

    } 
    
    else {
    print("uh oh, couldn't get dataset");
    // handle this later
    return null;
    }
  }
  // Else just return the dataset image
  else {
    var path = datasetPaths.filter(ee.Filter.eq('name', variable)).first().get('path').getInfo();
    return ee.Image(path);
  }
}

// Populates a dictionary of weights from input file (if there are input weights)
function getWeights(dict) {
  if (specificWeights == null) {
    return dict;
  }
  var new_dict = {};
  for (var key in dict) {
    var entry = specificWeights.filter(ee.Filter.eq('name',key)).first();
    var num = entry.get('weight').getInfo();
    new_dict[key] = Math.round(num * 100) / 100;
    
  }
  return new_dict;
}

// Classifies a variable according to its labels in specificInfo
// Returns 'subLayer' having a band corresponding to each variable
function createClassification(variableList, datasetPaths, startDate, endDate) {

  var subLayer = ee.Image(1);

  // Classifies a single variable and adds its classified image to subLayer
  function classifyVariable(variable) {
    var data = specificInfo.filter(ee.Filter.eq('name', variable)).first();

    var labels = ee.List(ee.String(data.get('labels')).split(',')).getInfo();
    var thresholds = ee.List(ee.String(data.get('thresholds')).split(',')).getInfo();
    var dataset = getDataset(variable, datasetPaths, startDate, endDate).clip(roi.geometry());

    var classification = ee.Image(1).reproject(dataset.projection()).rename(variable);
    // For variable, get each interval in thresholds and label it usings labels
    for (var i = 0; i < thresholds.length; i++) {
      var label = ee.Number(+labels[i]);
      // If the interval is a range, e.g. 0-50 maps to 1
      if (thresholds[i].indexOf('-') !== -1) {
        var interval = thresholds[i].split('-');
        var bottom = interval[0];
        var top = interval[1];
        if (top === 'posInf') {
        var bottom_num = ee.Number(+bottom);
        classification = classification.where(dataset.gte(bottom_num), label);
      }
        else if (bottom === 'negInf') {
          var top_num = ee.Number(+top);
          classification = classification.where(dataset.lte(top_num), label);
        }
        else {
          var top_num = ee.Number(+top);
          var bottom_num = ee.Number(+bottom);
          classification = classification.where(dataset.lte(top_num).and(dataset.gte(bottom_num)), label);
        }
      }
      
      // If the interval is a value (like a class code), e.g. AWC=3 maps to 1
      else {
        var val = ee.Number(+thresholds[i]);
        classification = classification.where(dataset.eq(val), label);
      }
      
    }
    
    subLayer = subLayer.addBands(classification).clip(roi.geometry());
  }
  
  variableList.forEach(classifyVariable);
  
  return subLayer;
}

var allLayers = ee.Image(1);

exports.getPSS = function(intervals, weights, datasetPaths, RoI, startDate, endDate, numLabels) {
// function getPSS(intervals, weights, datasetPaths, RoI, startDate, endDate, numLabels) {

  specificInfo = intervals;
  specificWeights = weights;
  roi = RoI;
  
  //=============== CLIMATE LAYER =======================//

  // Define the variables and default weights of this layer
  var climateVariables = [
    "annualPrecipitation", 
    "meanAnnualTemperature",
    "aridityIndex",
    "referenceEvapoTranspiration"
    ];
  
  var climateVariableWeights = {
    "annualPrecipitation":0.25, 
    "meanAnnualTemperature":0.25,
    "aridityIndex":0.25,
    "referenceEvapoTranspiration":0.25
    };
  // Get customized weights if they exist
  climateVariableWeights = getWeights(climateVariableWeights);
  
  // Get the classified sublayers  
  var climateSubLayers = createClassification(climateVariables, datasetPaths, startDate, endDate);
  
  // Get the final layer as weighted mean
  var climateLayer = climateSubLayers.expression(
    'w1 * annualPrecip + w2 * meanAnnualTemp + w3 * aridityIndex + w4 * refEvapoTransp', 
      {
        annualPrecip: climateSubLayers.select('annualPrecipitation'),
        w1: ee.Number(climateVariableWeights['annualPrecipitation']),
        meanAnnualTemp: climateSubLayers.select('meanAnnualTemperature'),
        w2: ee.Number(climateVariableWeights['meanAnnualTemperature']),
        aridityIndex: climateSubLayers.select('aridityIndex'),
        w3: ee.Number(climateVariableWeights['aridityIndex']),
        refEvapoTransp: climateSubLayers.select('referenceEvapoTranspiration'),
        w4: ee.Number(climateVariableWeights['referenceEvapoTranspiration']),
      }
    );
  
  climateLayer = climateLayer.rename('Climate');
  allLayers = allLayers.addBands(climateLayer);
  
  
  //=============== SOIL LAYER =======================//
  
  
  // First we take weighted mean of topsoilNutrients, subsoilNutrients and
  // rootingCondition, then combine them along with AWC and drainage in the final layer
  var soilVariables = [
    "topsoilPH",
    "topsoilCEC",
    "topsoilOC",
    "topsoilTexture",
    "topsoilBD",
    "subsoilPH",
    "subsoilCEC",
    "subsoilOC",
    "subsoilTexture",
    "subsoilBD",
    "drainage",
    "AWC"
    ];
  
  var topsoilNutrientWeights = {
    "tnTopsoilPH":0.25,
    "tnTopsoilCEC":0.25,
    "tnTopsoilOC":0.25,
    "tnTopsoilTexture":0.25
    };
  topsoilNutrientWeights = getWeights(topsoilNutrientWeights);
  
  var subsoilNutrientWeights = {
    "snSubsoilPH":0.25,
    "snSubsoilCEC":0.25,
    "snSubsoilOC":0.25,
    "snSubsoilTexture":0.25
    };
  subsoilNutrientWeights = getWeights(subsoilNutrientWeights);
  
  var rootingConditionWeights = {
    "rcTopsoilPH":0.25,
    "rcSubsoilPH":0.25,
    "rcTopsoilBD":0.25,
    "rcSubsoilBD":0.25
    };
  rootingConditionWeights = getWeights(rootingConditionWeights);
  
  
  var soilVariableWeights = {
    "topsoilNutrient":0.20,
    "subsoilNutrient":0.20,
    "rootingCondition":0.20,
    "drainage":0.20,
    "AWC":0.20
  }
  soilVariableWeights = getWeights(soilVariableWeights);
  
  var soilSubLayers = createClassification(soilVariables, datasetPaths, startDate, endDate);
  
  // Get the three sublayers
  var topsoilNutrientLayer = soilSubLayers.expression(
    'w1 * topsoilPH + w2 * topsoilOC + w3 * topsoilCEC + w4 * topsoilTexture', 
      {
        topsoilPH: soilSubLayers.select('topsoilPH'),
        w1: ee.Number(topsoilNutrientWeights['tnTopsoilPH']),
        topsoilOC: soilSubLayers.select('topsoilOC'),
        w2: ee.Number(topsoilNutrientWeights['tnTopsoilOC']),
        topsoilCEC: soilSubLayers.select('topsoilCEC'),
        w3: ee.Number(topsoilNutrientWeights['tnTopsoilCEC']),
        topsoilTexture: soilSubLayers.select('topsoilTexture'),
        w4: ee.Number(topsoilNutrientWeights['tnTopsoilTexture']),
      }
    );
  
  topsoilNutrientLayer = topsoilNutrientLayer.rename('topsoilNutrient')
  soilSubLayers = soilSubLayers.addBands(topsoilNutrientLayer);
  
  var subsoilNutrientLayer = soilSubLayers.expression(
    'w1 * subsoilPH + w2 * subsoilOC + w3 * subsoilCEC + w4 * subsoilTexture', 
      {
        subsoilPH: soilSubLayers.select('subsoilPH'),
        w1: ee.Number(subsoilNutrientWeights['snSubsoilPH']),
        subsoilOC: soilSubLayers.select('subsoilOC'),
        w2: ee.Number(subsoilNutrientWeights['snSubsoilOC']),
        subsoilCEC: soilSubLayers.select('subsoilCEC'),
        w3: ee.Number(subsoilNutrientWeights['snSubsoilCEC']),
        subsoilTexture: soilSubLayers.select('subsoilTexture'),
        w4: ee.Number(subsoilNutrientWeights['snSubsoilTexture']),
      }
    );  
  
  subsoilNutrientLayer = subsoilNutrientLayer.rename('subsoilNutrient');
  soilSubLayers = soilSubLayers.addBands(subsoilNutrientLayer);
  
  var rootingConditionLayer = soilSubLayers.expression(
    'w1 * topsoilPH + w2 * topsoilBD + w3 * subsoilPH + w4 * subsoilBD', 
      {
        topsoilPH: soilSubLayers.select('topsoilPH'),
        w1: ee.Number(rootingConditionWeights['rcTopsoilPH']),
        topsoilBD: soilSubLayers.select('topsoilBD'),
        w2: ee.Number(rootingConditionWeights['rcTopsoilBD']),
        subsoilPH: soilSubLayers.select('subsoilPH'),
        w3: ee.Number(rootingConditionWeights['rcSubsoilPH']),
        subsoilBD: soilSubLayers.select('subsoilBD'),
        w4: ee.Number(rootingConditionWeights['rcSubsoilBD']),
      }
    );
  
  rootingConditionLayer = rootingConditionLayer.rename('rootingCondition');
  soilSubLayers = soilSubLayers.addBands(rootingConditionLayer);
  
  // Get final soil layer
  var soilLayer = soilSubLayers.expression(
    'w1 * topsoilNutrient + w2 * subsoilNutrient + w3 * rootingCondition + w4 * drainage + w5 * AWC', 
      {
        topsoilNutrient: soilSubLayers.select('topsoilNutrient'),
        w1: ee.Number(soilVariableWeights['topsoilNutrient']),
        subsoilNutrient: soilSubLayers.select('subsoilNutrient'),
        w2: ee.Number(soilVariableWeights['subsoilNutrient']),
        rootingCondition: soilSubLayers.select('rootingCondition'),
        w3: ee.Number(soilVariableWeights['rootingCondition']),
        drainage: soilSubLayers.select('drainage'),
        w4: ee.Number(soilVariableWeights['drainage']),
        AWC: soilSubLayers.select('AWC'),
        w5: ee.Number(soilVariableWeights['AWC'])
      }
    );
  
  soilLayer = soilLayer.rename('Soil');
  allLayers = allLayers.addBands(soilLayer);
  
  
  //===============TOPOGRAPHY LAYER =======================//
  
  
  var topographyVariables = [
    "elevation",
    "slope",
    "aspect"
    ];
  
  var topographyVariableWeights = {
    "elevation":0.4,
    "slope":0.4,
    "aspect":0.2  
  }
  topographyVariableWeights = getWeights(topographyVariableWeights);
  
  var topographySubLayers = createClassification(topographyVariables, datasetPaths, startDate, endDate);
  
  var topographyLayer = topographySubLayers.expression(
    'w1 * elevation + w2 * slope + w3 * aspect', 
      {
        elevation: topographySubLayers.select('elevation'),
        w1: ee.Number(topographyVariableWeights['elevation']),
        slope: topographySubLayers.select('slope'),
        w2: ee.Number(topographyVariableWeights['slope']),
        aspect: topographySubLayers.select('aspect'),
        w3: ee.Number(topographyVariableWeights['aspect']),
      }
    );
    
  topographyLayer = topographyLayer.rename('Topography');
  allLayers = allLayers.addBands(topographyLayer);
  
  
  //=============== ECOLOGY LAYER =======================//
  
  
  var ecologyVariables = [
    "NDVI",
    "LULC"
    ];
  
  var ecologyVariableWeights = {
    "NDVI":0.5,
    "LULC":0.5
    };
  ecologyVariableWeights = getWeights(ecologyVariableWeights);
  
  var ecologySubLayers = createClassification(ecologyVariables, datasetPaths, startDate, endDate);
  
  var ecologyLayer = ecologySubLayers.expression(
    'w1 * NDVI + w2 * LULC',
    {
      NDVI: ecologySubLayers.select('NDVI'),
      w1: ee.Number(ecologyVariableWeights['NDVI']),
      LULC: ecologySubLayers.select('LULC'),
      w2: ee.Number(ecologyVariableWeights['LULC'])
    }
  );
  
  ecologyLayer = ecologyLayer.rename('Ecology');
  allLayers = allLayers.addBands(ecologyLayer);
  
  
  //=============== SOCIOECONOMIC LAYER =======================//
  
  
  var socioeconomicVariables = [
    "distToRoad",
    "distToDrainage",
    "distToSettlements"
    ];
  
  var socioeconomicVariableWeights = {
    "distToRoad":0.33,
    "distToDrainage":0.33,
    "distToSettlements":0.34
    };
  socioeconomicVariableWeights = getWeights(socioeconomicVariableWeights);
  
  var socioeconomicSubLayers = createClassification(socioeconomicVariables, datasetPaths, startDate, endDate);
  
  var socioeconomicLayer = socioeconomicSubLayers.expression(
    'w1 * distToRoad + w2 * distToDrainage + w3 * distToSettlements',
    {
      distToRoad: socioeconomicSubLayers.select('distToRoad'),
      w1: ee.Number(socioeconomicVariableWeights['distToRoad']),
      distToDrainage: socioeconomicSubLayers.select('distToDrainage'),
      w2: ee.Number(socioeconomicVariableWeights['distToDrainage']),
      distToSettlements: socioeconomicSubLayers.select('distToSettlements'),
      w3: ee.Number(socioeconomicVariableWeights['distToSettlements'])
    }
  );
  
  socioeconomicLayer = socioeconomicLayer.rename('Socioeconomic');
  allLayers = allLayers.addBands(socioeconomicLayer);
  
  
  //=============== FINAL SUITABILITY LAYER =======================//
  
  var finalVariables = [
    "Climate",
    "Soil",
    "Topography",
    "Ecology",
    "Socioeconomic"
    ];
    
  var finalWeights = {
    "Climate":0.25,
    "Soil":0.20,
    "Topography":0.30,
    "Ecology":0.10,
    "Socioeconomic":0.15
    };
  finalWeights = getWeights(finalWeights);

  var finalLayer = allLayers.expression(
    'w1 * Climate + w2 * Soil + w3 * Topography + w4 * Ecology + w5 * Socioeconomic',
    {
      Climate: allLayers.select('Climate'),
      w1: ee.Number(finalWeights['Climate']),
      Soil: allLayers.select('Soil'),
      w2: ee.Number(finalWeights['Soil']),
      Topography: allLayers.select('Topography'),
      w3: ee.Number(finalWeights['Topography']),
      Ecology: allLayers.select('Ecology'),
      w4: ee.Number(finalWeights['Ecology']),
      Socioeconomic: allLayers.select('Socioeconomic'),
      w5: ee.Number(finalWeights['Socioeconomic'])
    }
  );
  
  finalLayer = finalLayer.rename('Final');

  
  //=============== OUTPUT =======================//


  
  // For two suitability classes
  if (numLabels == 2) {
    var finalPlantationScore = ee.Image(1)
                              .where(finalLayer.lte(0.5),0)
                              .clip(roi.geometry());
  }
  
  // For five suitability classes
  else {
    finalPlantationScore = ee.Image(0)
      .where(finalLayer.lt(1.5), 1)
      .where(finalLayer.gte(1.5).and(finalLayer.lt(2.5)), 2)
      .where(finalLayer.gte(2.5).and(finalLayer.lt(3.5)), 3)
      .where(finalLayer.gte(3.5).and(finalLayer.lt(4.5)), 4)
      .where(finalLayer.gte(4.5), 5)
      .clip(roi.geometry());
  }       

  // Classes to be masked for in IndiaSat LULC v3 - 5 (Croplands), 6 (Trees/forests),
  // 7 (Barren lands), 8 (Single Kharif Cropping), 9 (Single Non Kharif Cropping),
  // 10 (Double Cropping), 11 (Triple Cropping), 12 (Shrub and Scrub)
  
  var lulc = getDataset('LULC', datasetPaths, startDate, endDate).clip(roi);
  var lulcMask = lulc.gte(5);

  finalPlantationScore = finalPlantationScore.updateMask(lulcMask);
  finalPlantationScore = finalPlantationScore.rename('Final Score');
  return allLayers.addBands(finalPlantationScore);

}


// var pss = getPSS(specificInfo, specificWeights, datasets, roi, '2023-07-01', '2024-06-30', 2);
// print(pss);

// var lulc = getDataset('distToSettlements', datasets, '2021-07-01', '2024-06-30');
// print(lulc);
  
// // Set up palette, visparams, names based on how many classes/labels

// var numLabels = 2;

// // // Five labels

// // var palette = ["147218", "8562EA", "f2fe2a", "ffac18", "fe3c19"];
// // var visparams = {
// //   "opacity": 1,
// //     "min": 1,
// //     "max": 5,
// //     "palette": palette
// // };
// // var names = ['Very Good','Good','Moderate', 'Marginally Suitable', 'Unsuitable'];


// // Two labels

// var palette = ["fe3c19", "147218"];
// var visparams = {
//   "opacity": 1,
//     "min": 0,
//     "max": 1,
//     "palette": palette
// };
// var names = ['Unsuitable', 'Suitable'];


// // Set up legend

// var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px'}});
// var makeRow = function(color, name) {
//       var colorBox = ui.Label({
//         style: {
//           backgroundColor: '#' + color,
//           padding: '8px',
//           margin: '0 0 4px 0'
//         }
//       });
 
//       var description = ui.Label({
//         value: name,
//         style: {margin: '0 0 4px 6px'}
//       });
  
//       return ui.Panel({
//         widgets: [colorBox, description],
//         layout: ui.Panel.Layout.Flow('horizontal')
//       });
// };

// for (var i = 0; i < numLabels; i++) {
//   legend.add(makeRow(palette[i], names[i]));
//   }  

// // Map.add(legend);


// // // Add all layers to the map

// // Map.addLayer(climateLayer, visparams, 'Climate Sub Layer');
// // Map.addLayer(soilLayer, visparams, 'Soil Sub Layer');
// // Map.addLayer(topographyLayer, visparams, 'Topography Sub Layer');
// // Map.addLayer(ecologyLayer, visparams, 'Ecology Sub Layer');
// // Map.addLayer(socioeconomicLayer, visparams, 'Socio-economic Sub Layer');
// // Map.addLayer(finalPlantationScore, visparams, 'Final Suitability Score');
// // // Map.addLayer(roi.geometry(), {}, 'Boundary');
// // Map.centerObject(roi.geometry(),18);




