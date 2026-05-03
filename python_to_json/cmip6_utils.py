"""
This module consists of custom functions for our team's DSC 106 Project 3 workflow, primarily for retriving CMIP6 data from Google Cloud Storage (using the gcsfs library) and converting it into JSON formats for manipulation in D3. 
"""

import pandas as pd
import numpy as np
import xarray as xr
import zarr
import gcsfs
import json
import io

gcs = gcsfs.GCSFileSystem(token='anon') # Used for retrieving data from GCSFS
zstores = pd.read_csv('https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv') # This CSV contains information on the CMIP6 simulations, organized by information such as model, organization, simulation parameters, and a link to the zarr files for the simulation data. Each zarr file records a specific variable (e.g. surface air temperature, CO2 levels, tree coverage) over a global lattitude-longitude grid over time (resulting in 3 Dimensional dataset).

def filter_zstore_df(activity_id=None, institution_id=None, source_id=None, experiment_id=None, member_id=None,table_id=None,variable_id=None,grid_id=None):
    '''
    This returns a filtered zstore table for all entries that match the given query.
    See https://docs.google.com/document/d/1yUx6jr9EdedCOLd--CPdTfGDwEwzPpCF6p1jRmqx-0Q/ for an explanation of each of the variables in the original table.
    ----
    Parameters:
        This function features 8 keyword parameters corresponding to each id in the original zstore table: 
            activity_id: MIP/Project that organized the experiment
            institution_id: Modeling center/institution
            source_id: Model name
            experiment_id: Experiment/parameters of simulation
            member_id: realization/esnsemble number in format r#i#p#f# for run/init/physics/forcing
            table_id: Frequency of variable/domain table in dataset (e.g. Amon is for monthly atmosphere data, 3hr means the data is logged every 3 horus)
            variable_id: What variable is stored in the zarr 
            grid_id: What kind of geospatial grid the data is mapped to
    ----
    Returns:
        A Pandas DataFrame object with each row being a zarr from the table that match the given query.
    '''

    # TODO: Add a filter for date based on 'version' variable?

    activity_query = zstores['activity_id']==activity_id if activity_id != None else None
    inst_query = zstores['institution_id'].str.contains(institution_id) if institution_id != None else None
    source_query = zstores['source_id'].str.contains(source_id) if source_id != None else None
    exp_query = zstores['experiment_id']==(experiment_id) if experiment_id != None else None
    member_query = zstores['member_id']==(member_id) if member_id != None else None
    table_query = zstores['table_id']==(table_id) if table_id != None else None
    var_query = zstores['variable_id']==(variable_id) if variable_id != None else None
    grid_query = zstores['grid_id']==(grid_id) if grid_id != None else None
    query = pd.Series(True, index=zstores.index) # create a series of Trues
    for i in (activity_query, inst_query, source_query, exp_query, member_query, table_query, var_query, grid_query):
        if i is not None:
            query = query & i
    return zstores[query]

def retrieve_xarr(zstore):
    '''
    This function takes a GCS zstore path (as seen in the 'zstore' column of the dataframe) and returns an xarray DataSet containing the data stored in the corresponding zarr file. 
    Uses the xarray and gcsfs modules
    ----
    Parameters:
        zstore: A string representing a path in Google Cloud Storage for CMIP6 data
    ----
    Returns:
        A xarray DataSet object.
    '''
    mapper = gcs.get_mapper(zstore) # create a mutable-mapping-style interface to the store
    ds = xr.open_zarr(mapper, consolidated=True) # open it using xarray and zarr
    return ds

def to_isostring(datetime_obj):
        '''
        This helper function turns a datetime object (specifically the cftime datetime objects seen in the CMIP6 DataSets) and converts them into strings using .isoformat()
        This function is specifically meant to be passed as a value for the 'default' parameter in json.dumps(), which is called when the function encounters a python object it does not know how to convert into a valid JSON format. If you're encountering an error while calling the parent function, it may be because there is some object in the DataSet that's not a datetime object that this function is being called on.
        '''
        return datetime_obj.isoformat()

def to_json_str(ds, as_str=True):
    '''
    Given an xarray Dataset (or DataArray), this function converts all the data into a valid string formatted in JSON, using the xarray.Dataset.to_dict() function. All datetimes will be converted to strings in ISO8601 format.
    May take multiple minutes to run.
    ----
    Parameters:
        ds: An xarray Dataset object
        as_str: Default set to True. Returns the data as a string if set to True. If False, returns the underlying Python dictionary.
    ----
    Returns:
        A string containing all the data from 'ds' formatted in valid JSON , or the underlying Python dictionary if as_str was set to False. These can be very large, so printing and displaying them can take a lot of time.
    '''

    # xarray documentation recommends using .compute() (which returns a deep copy of the data) for efficient conversion of the data into the python list format.
    data_dict = ds.compute().to_dict()

    if not as_str:
        return data_dict

    json_str = json.dumps(data_dict, indent=4, default=to_isostring)

    return json_str

def to_json_file(ds, filename='cmip6_xarr'):
    '''
    Given an xarray Dataset (or DataArray), this function converts the data into a valid JSON file using the xarray.Dataset.to_dict() function. If 'ds' is already a string or dictionary, the function will write it into a .json file.
    Make sure the filename is unique, as this function will create a completely new file at the given filename, overwriting any other .json file that shares its name.
    May take multiple minutes to run.
    ----
    Parameters:
        ds: An xarray Dataset object
        filename: filename (without extension) to save the JSON file too
    ----
    Returns:
        Nothing. Will output a file
    '''

    filename += ".json" # add the .json extension

    if type(ds) == dict:
        with open(filename, 'w') as f:
            json.dump(ds, f, indent=4, default=to_isostring)

        return

    if type(ds) == str:
        json_str = ds
    else:
        json_str = to_json_str(ds)
    
    with open(filename, 'w') as f:
        f.write(json_str)


