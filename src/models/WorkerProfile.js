const mongoose = require('mongoose');

const workerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  categories: [{
    mainCategory: {
      type: String,
      enum: ['professional', 'skilled', 'casual', 'technical']
    },
    subCategory: {
      type: String,
      enum: ['House Maid', 'Nannies', 'House Keeps', 'Gardeners', 'Janitors', 
             'Cook', 'Laundry Worker', 'Care-givers', 'Home Nurse', 
             'Casual Domestic Helpers', 'Delivery Guys',
             'Electrician', 'Plumber', 'Carpenter', 'Mechanic']
    },
    experience: Number,
    certifications: [String]
  }],
  skills: [{
    name: String,
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'expert']
    },
    yearsOfExperience: Number
  }],
  workExperience: [{
    jobTitle: String,
    company: String,
    duration: String,
    description: String,
    startDate: Date,
    endDate: Date,
    isCurrent: Boolean
  }],
  testimonials: [{
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    clientName: String,
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    date: {
      type: Date,
      default: Date.now
    }
  }],
  badges: [{
    name: {
      type: String,
      enum: ['Top Rated', 'Reliable', 'Fast Responder', 'Experienced', 'Trained', 'Verified']
    },
    earnedDate: {
      type: Date,
      default: Date.now
    },
    description: String
  }],
  availability: {
    status: {
      type: String,
      enum: ['available', 'busy', 'offline', 'on_leave'],
      default: 'offline'
    },
    onDuty: {
      type: Boolean,
      default: false
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    },
    lastLocationUpdate: Date,
    workingHours: {
      start: {
        type: String,
        default: '09:00'
      },
      end: {
        type: String,
        default: '17:00'
      }
    },
    availableDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }]
  },
  rates: {
    daily: {
      type: Number,
      default: 0
    },
    weekly: {
      type: Number,
      default: 0
    },
    monthly: {
      type: Number,
      default: 0
    },
    hourly: {
      type: Number,
      default: 0
    }
  },
  skillLevel: {
    type: String,
    enum: ['skilled', 'unskilled'],
    default: 'unskilled'
  },
  nitaTrained: {
    type: Boolean,
    default: false
  },
  trainingStatus: {
    enrolled: {
      type: Boolean,
      default: false
    },
    courseName: String,
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    completionDate: Date,
    sponsor: {
      type: String,
      enum: ['self', 'company'],
      default: 'self'
    }
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  totalJobsCompleted: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  documents: {
    cv: String,
    certificates: [String],
    portfolio: [String],
    idPhoto: String
  }
}, {
  timestamps: true
});

// Create geospatial index
workerProfileSchema.index({ 'availability.currentLocation': '2dsphere' });

// Method to update average rating
workerProfileSchema.methods.updateAverageRating = async function() {
  if (this.testimonials.length > 0) {
    const total = this.testimonials.reduce((sum, t) => sum + t.rating, 0);
    this.averageRating = total / this.testimonials.length;
    await this.save();
  }
  return this.averageRating;
};

module.exports = mongoose.model('WorkerProfile', workerProfileSchema);