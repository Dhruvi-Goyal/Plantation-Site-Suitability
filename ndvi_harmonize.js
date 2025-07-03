// Chastain band names
var chastainBandNames = ['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2'];

// Regression model parameters
var msiOLISlopes = [1.0946, 1.0043, 1.0524, 0.8954, 1.0049, 1.0002];
var msiOLIIntercepts = [-0.0107, 0.0026, -0.0015, 0.0033, 0.0065, 0.0046];

var msiETMSlopes = [1.10601, 0.99091, 1.05681, 1.0045, 1.03611, 1.04011];
var msiETMIntercepts = [-0.0139, 0.00411, -0.0024, -0.0076, 0.00411, 0.00861];

var oliETMSlopes = [1.03501, 1.00921, 1.01991, 1.14061, 1.04351, 1.05271];
var oliETMIntercepts = [-0.0055, -0.0008, -0.0021, -0.0163, -0.0045, 0.00261];

// Coefficient dictionary
var chastainCoeffDict = {
  'MSI_OLI': [msiOLISlopes, msiOLIIntercepts, 1],
  'MSI_ETM': [msiETMSlopes, msiETMIntercepts, 1],
  'OLI_ETM': [oliETMSlopes, oliETMIntercepts, 1],
  'OLI_MSI': [msiOLISlopes, msiOLIIntercepts, 0],
  'ETM_MSI': [msiETMSlopes, msiETMIntercepts, 0],
  'ETM_OLI': [oliETMSlopes, oliETMIntercepts, 0]
};

// Cloud masking function for Landsat-7
function maskL7cloud(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(mask)
    .select(['B1', 'B2', 'B3', 'B4', 'B5', 'B7'])
    .rename(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']);
}

// Cloud masking function for Landsat-8
function maskL8cloud(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 4).eq(0);
  return image.updateMask(mask)
    .select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7'])
    .rename(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']);
}

// Cloud masking function for Sentinel-2 TOA
function maskS2cloudTOA(image) {
  var qa = image.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask)
    .select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
    .rename(['BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2']);
}

// Function to get Landsat-7, Landsat-8, and Sentinel-2 image collections
function Get_L7_L8_S2_ImageCollections(inputStartDate, inputEndDate, roi_boundary) {
  var L7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
    .filterDate(inputStartDate, inputEndDate)
    .filterBounds(roi_boundary)
    .map(maskL7cloud);

  var L8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
    .filterDate(inputStartDate, inputEndDate)
    .filterBounds(roi_boundary)
    .map(maskL8cloud);

  var S2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterDate(inputStartDate, inputEndDate)
    .filterBounds(roi_boundary)
    .map(maskS2cloudTOA);

  return {L7: L7, L8: L8, S2: S2};
}

// Function to apply regression model in one direction
function dir0Regression(img, slopes, intercepts) {
  return img.select(chastainBandNames).multiply(slopes).add(intercepts);
}

// Function to apply regression model in the opposite direction
function dir1Regression(img, slopes, intercepts) {
  return img.select(chastainBandNames).subtract(intercepts).divide(slopes);
}

// Harmonization function
function harmonizationChastain(img, fromSensor, toSensor) {
  var comboKey = fromSensor.toUpperCase() + '_' + toSensor.toUpperCase();
  var coeffList = chastainCoeffDict[comboKey];
  var slopes = coeffList[0];
  var intercepts = coeffList[1];
  var direction = ee.Number(coeffList[2]);

  var out = ee.Algorithms.If(
    direction.eq(0),
    dir0Regression(img, slopes, intercepts),
    dir1Regression(img, slopes, intercepts)
  );
  return ee.Image(out).copyProperties(img).copyProperties(img, ['system:time_start']);
}

// Function to harmonize Landsat-8 and Sentinel-2 to Landsat-7
function Harmonize_L7_L8_S2(L7, L8, S2) {
  var harmonized_L8 = L8.map(function(img) {
    return harmonizationChastain(img, 'OLI', 'ETM');
  });
  var harmonized_S2 = S2.map(function(img) {
    return harmonizationChastain(img, 'MSI', 'ETM');
  });
  var harmonized_LandsatSentinel_ic = ee.ImageCollection(L7.merge(harmonized_L8).merge(harmonized_S2));
  return harmonized_LandsatSentinel_ic;
}

// Function to add NDVI band
function addNDVI(image) {
  var ndvi = image.normalizedDifference(['NIR', 'RED']).rename('NDVI');
  return image.addBands(ndvi).float();
}

// Function to create NDVI time series from harmonized image collection
function Get_NDVI_image_datewise(harmonized_LS_ic, roi_boundary) {
  return function(date) {
    var emptyBandImage = ee.Image(0).float().rename(['NDVI']).updateMask(ee.Image(0).clip(roi_boundary));
    return harmonized_LS_ic.select(['NDVI'])
      .filterDate(ee.Date(date), ee.Date(date).advance(16, 'day'))
      .merge(emptyBandImage)
      .median()
      .set('system:time_start', ee.Date(date).millis());
  };
}

// Function to create a 16-day NDVI time series
function Get_LS_16Day_NDVI_TimeSeries(inputStartDate, inputEndDate, harmonized_LS_ic, roi_boundary) {
  var startDate = ee.Date(inputStartDate);
  var endDate = ee.Date(inputEndDate);

  var dateList = ee.List.sequence(startDate.millis(), endDate.millis(), 16 * 24 * 60 * 60 * 1000);
  var images = dateList.map(Get_NDVI_image_datewise(harmonized_LS_ic, roi_boundary));
  return ee.ImageCollection.fromImages(images);
}

// Function to pair available LSC and MODIS values for each timestamp
function pairLSModis(lsRenameBands, roi_boundary) {
  return function(feature) {
    var date = ee.Date(feature.get('system:time_start'));
    var startDateT = date.advance(-8, 'day');
    var endDateT = date.advance(8, 'day');

    // MODIS VI (We can add EVI to the band list later)
    var modis = ee.ImageCollection('MODIS/061/MOD13Q1')
      .filterDate(startDateT, endDateT)
      .select(['NDVI', 'SummaryQA'])
      .filterBounds(roi_boundary)
      .median()
      .rename(['NDVI_modis', 'SummaryQA_modis']);

    return feature.rename(lsRenameBands).addBands(modis);
  };
}

// Function to get Pearson Correlation Coefficient for gap filling
function get_Pearson_Correlation_Coefficients(LSC_modis_paired_ic, roi_boundary, bandList) {
  var corr = LSC_modis_paired_ic.filterBounds(roi_boundary)
    .select(bandList)
    .toArray()
    .arrayReduce({
      reducer: ee.Reducer.pearsonsCorrelation(),
      axes: [0],
      fieldAxis: 1
    })
    .arrayProject([1])
    .arrayFlatten([['c', 'p']]);
  return corr;
}


// Function to perform gap filling with MODIS data
function gapfillLSM(LSC_modis_regression_model, LSC_bandName, modis_bandName) {
  return function(image) {
    var offset = LSC_modis_regression_model.select('offset');
    var scale = LSC_modis_regression_model.select('scale');
    var nodata = -1;

    var lsc_image = image.select(LSC_bandName);
    var modisfit = image.select(modis_bandName).multiply(scale).add(offset);
    var mask = lsc_image.mask();
    var gapfill = lsc_image.unmask(nodata).where(mask.not(), modisfit);

    var qc_m = image.select('SummaryQA_modis').unmask(3);
    var w_m = modisfit.mask().rename('w_m').where(qc_m.eq(0), 0.8);
    w_m = w_m.where(qc_m.eq(1), 0.5);
    w_m = w_m.where(qc_m.gte(2), 0.2);

    var w_l = gapfill.mask().where(mask.not(), w_m);
    return gapfill.addBands(w_l).rename(['gapfilled_' + LSC_bandName, 'SummaryQA']);
  };
}

// Function to combine Landsat-Sentinel with MODIS
function Combine_LS_Modis(LSC, roi_boundary) {
  var lsRenameBands = ee.Image(LSC.first()).bandNames().map(function(band) {
    return ee.String(band).cat('_lsc');
  });
  var LSC_modis_paired_ic = LSC.map(pairLSModis(lsRenameBands, roi_boundary));

  var LSC_modis_regression_model_NDVI = LSC_modis_paired_ic.select(['NDVI_modis', 'NDVI_lsc'])
    .reduce(ee.Reducer.linearFit());

  var LSMC_NDVI = LSC_modis_paired_ic.map(
    gapfillLSM(LSC_modis_regression_model_NDVI, 'NDVI_lsc', 'NDVI_modis')
  );
  return LSMC_NDVI;
}

// Function to mask low quality pixels
function mask_low_QA(lsmc_image) {
  var low_qa = lsmc_image.select('SummaryQA').neq(0.2);
  return lsmc_image.updateMask(low_qa).copyProperties(lsmc_image, ['system:time_start']);
}

// Function to add timestamp to each image in the time series
function add_timestamp(image) {
  var timeImage = image.metadata('system:time_start').rename('timestamp');
  var timeImageMasked = timeImage.updateMask(image.mask().select(0));
  return image.addBands(timeImageMasked);
}

// Perform linear interpolation on missing values
function performInterpolation(image) {
  var beforeImages = ee.List(image.get('before'));
  var beforeMosaic = ee.ImageCollection.fromImages(beforeImages).mosaic();
  var afterImages = ee.List(image.get('after'));
  var afterMosaic = ee.ImageCollection.fromImages(afterImages).mosaic();

  var t1 = beforeMosaic.select('timestamp').rename('t1');
  var t2 = afterMosaic.select('timestamp').rename('t2');
  var t = ee.Image.constant(image.get('system:time_start')).rename('t');
  var timeImage = ee.Image.cat([t1, t2, t]);
  var timeRatio = timeImage.expression(
    '(t - t1) / (t2 - t1)',
    {
      't': timeImage.select('t'),
      't1': timeImage.select('t1'),
      't2': timeImage.select('t2')
    }
  );

  var interpolated = beforeMosaic.add((afterMosaic.subtract(beforeMosaic)).multiply(timeRatio));
  var result = ee.Image(image).unmask(interpolated);
  var fill_value = ee.ImageCollection([beforeMosaic, afterMosaic]).mosaic();
  result = result.unmask(fill_value);

  return result.copyProperties(image, ['system:time_start']);
}

// Function to interpolate time series
function interpolate_timeseries(S1_TS) {
  var lsmc_masked = S1_TS.map(mask_low_QA);
  var filtered = lsmc_masked.map(add_timestamp);

  var timeWindow = 120;
  var millis = ee.Number(timeWindow).multiply(1000 * 60 * 60 * 24);
  var maxDiffFilter = ee.Filter.maxDifference({
    difference: millis,
    leftField: 'system:time_start',
    rightField: 'system:time_start'
  });

  var lessEqFilter = ee.Filter.lessThanOrEquals({
    leftField: 'system:time_start',
    rightField: 'system:time_start'
  });
  var greaterEqFilter = ee.Filter.greaterThanOrEquals({
    leftField: 'system:time_start',
    rightField: 'system:time_start'
  });

  var filter1 = ee.Filter.and(maxDiffFilter, lessEqFilter);
  var join1 = ee.Join.saveAll({
    matchesKey: 'after',
    ordering: 'system:time_start',
    ascending: false
  });
  var join1Result = join1.apply({
    primary: filtered,
    secondary: filtered,
    condition: filter1
  });

  var filter2 = ee.Filter.and(maxDiffFilter, greaterEqFilter);
  var join2 = ee.Join.saveAll({
    matchesKey: 'before',
    ordering: 'system:time_start',
    ascending: true
  });
  var join2Result = join2.apply({
    primary: join1Result,
    secondary: join1Result,
    condition: filter2
  });

  var interpolated_S1_TS = ee.ImageCollection(join2Result.map(performInterpolation));
  return interpolated_S1_TS;
}

// Function to get padded NDVI LSMC time series image for a given ROI
exports.harmonizedNDVI = function(startDate, endDate, roi_boundary) {
// var harmonizedNDVI = function(startDate, endDate, roi_boundary) {

  var result = Get_L7_L8_S2_ImageCollections(startDate, endDate, roi_boundary);
  var L7 = result.L7;
  var L8 = result.L8;
  var S2 = result.S2;

  var harmonized_LS_ic = Harmonize_L7_L8_S2(L7, L8, S2);
  harmonized_LS_ic = harmonized_LS_ic.map(addNDVI);
  var LSC = Get_LS_16Day_NDVI_TimeSeries(startDate, endDate, harmonized_LS_ic, roi_boundary);
  var LSMC_NDVI = Combine_LS_Modis(LSC, roi_boundary);
  // LSC, LSMC not null
  
  var Interpolated_LSMC_NDVI = interpolate_timeseries(LSMC_NDVI);
  var Interpolated_LSMC_NDVI_clipped = Interpolated_LSMC_NDVI.map(function(image) {
    return image.clip(roi_boundary);
  })
  return Interpolated_LSMC_NDVI_clipped;
}

// var roi_boundary = 
//   ee.Image("projects/df-project-iit/assets/core-stack/odisha/kalahandi/bhawanipatna/kalahandi_bhawanipatna_2023-07-01_2024-06-30_LULCmap_10m")
//   .geometry();
// // Set start and end dates
// var startDate = '2023-07-01';
// var endDate = '2024-06-30';

// var ndviImage = harmonizedNDVI(startDate, endDate, roi_boundary);
// print(ndviImage);



