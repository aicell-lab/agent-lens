import React, { useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

const DualRangeSlider = ({
  min = 0,
  max = 255,
  value = { min: 0, max: 255 },
  onChange,
  step = 1,
  disabled = false,
  className = '',
  style = {},
  channelColor = '#3b82f6'
}) => {
  const [isDragging, setIsDragging] = useState(null); // 'min', 'max', or null
  const sliderRef = useRef(null);

  // Ensure min value is never greater than max value
  const normalizedValue = {
    min: Math.min(value.min, value.max),
    max: Math.max(value.min, value.max)
  };

  const getPercentage = useCallback((val) => {
    return ((val - min) / (max - min)) * 100;
  }, [min, max]);

  const getValueFromPercentage = useCallback((percentage) => {
    return Math.round(min + (percentage / 100) * (max - min));
  }, [min, max]);

  const handleMouseDown = useCallback((e, thumb) => {
    if (disabled) return;
    e.preventDefault();
    setIsDragging(thumb);
  }, [disabled]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newValue = getValueFromPercentage(percentage);

    if (isDragging === 'min') {
      const newMin = Math.min(newValue, normalizedValue.max - step);
      onChange({ min: newMin, max: normalizedValue.max });
    } else if (isDragging === 'max') {
      const newMax = Math.max(newValue, normalizedValue.min + step);
      onChange({ min: normalizedValue.min, max: newMax });
    }
  }, [isDragging, normalizedValue, step, onChange, getValueFromPercentage]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  // Add global event listeners when dragging
  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const minPercentage = getPercentage(normalizedValue.min);
  const maxPercentage = getPercentage(normalizedValue.max);

  return (
    <div className={`dual-range-slider ${className}`} style={style}>
      <div className="dual-range-slider__track" ref={sliderRef}>
        <div 
          className="dual-range-slider__range"
          style={{
            left: `${minPercentage}%`,
            width: `${maxPercentage - minPercentage}%`,
            background: `linear-gradient(to right, black 0%, ${channelColor} 100%)`
          }}
        />
        <div
          className="dual-range-slider__thumb dual-range-slider__thumb--min"
          style={{ left: `${minPercentage}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'min')}
        />
        <div
          className="dual-range-slider__thumb dual-range-slider__thumb--max"
          style={{ left: `${maxPercentage}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'max')}
        />
      </div>
      <div className="dual-range-slider__values">
        <span className="dual-range-slider__value dual-range-slider__value--min">
          {normalizedValue.min}
        </span>
        <span className="dual-range-slider__value dual-range-slider__value--max">
          {normalizedValue.max}
        </span>
      </div>
    </div>
  );
};

DualRangeSlider.propTypes = {
  min: PropTypes.number,
  max: PropTypes.number,
  value: PropTypes.shape({
    min: PropTypes.number.isRequired,
    max: PropTypes.number.isRequired
  }),
  onChange: PropTypes.func.isRequired,
  step: PropTypes.number,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  style: PropTypes.object,
  channelColor: PropTypes.string
};

export default DualRangeSlider;
