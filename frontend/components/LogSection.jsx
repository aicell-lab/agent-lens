import React from 'react';
import PropTypes from 'prop-types';

const LogSection = ({ log }) => {
  return (
    <div className="control-view w-full bg-gray-100 p-4 border-t border-gray-300 box-border">
      <h3 className="text-lg font-semibold mb-2">Log</h3>
      <div className="max-h-52 overflow-y-auto bg-gray-200 p-2 rounded-lg">
        <pre className="text-sm font-normal">{log}</pre>
      </div>
    </div>
  );
};



LogSection.propTypes = {
  log: PropTypes.string.isRequired,
};

export default LogSection;