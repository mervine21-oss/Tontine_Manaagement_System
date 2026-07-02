// =============================================================================
// FILE: js/api.js
// PROJECT: DigiTon — Digital Tontine Management System
// PURPOSE: Shared API helper for the plain HTML frontend.
// =============================================================================

var BASE_URL = 'http://localhost:3000/api';
var APP_URL = 'http://localhost:8080';

function getToken() {
    return localStorage.getItem('token');
}

function getUser() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (error) {
        return {};
    }
}

function isLoggedIn() {
    return !!getToken();
}

function requireAuth() {
    var token = getToken();
    if (!token) {
        window.location.href = 'http://localhost:8080/index.html';
    }
}

function apiRequest(endpoint, method, body) {
    var token = getToken();
    var headers = {
        'Content-Type': 'application/json'
    };

    if (token) {
        headers.Authorization = 'Bearer ' + token;
    }

    var options = {
        method: method || 'GET',
        headers: headers
    };

    if (body !== null && body !== undefined) {
        options.body = JSON.stringify(body);
    }

    return fetch(BASE_URL + endpoint, options).then(function(response) {
        return response.text().then(function(text) {
            var data = text ? JSON.parse(text) : {};
            if (!response.ok) {
                throw new Error(data.error && data.error.message ? data.error.message : data.message || 'Request failed');
            }
            return data;
        });
    }).catch(function(error) {
        if (error.message === 'Failed to fetch') {
            throw new Error('Cannot connect to server. Make sure the backend is running.');
        }
        throw error;
    });
}

var auth = {
    register: function(data) {
        return apiRequest('/auth/register', 'POST', data);
    },
    login: function(data) {
        return apiRequest('/auth/login', 'POST', data);
    },
    me: function() {
        return apiRequest('/auth/me');
    }
};

var groups = {
    getAll: function() {
        return apiRequest('/groups');
    },
    getOne: function(id) {
        return apiRequest('/groups/' + id);
    },
    create: function(data) {
        return apiRequest('/groups', 'POST', data);
    },
    join: function(inviteCode) {
        return apiRequest('/groups/join', 'POST', { invite_code: inviteCode });
    },
    getMembers: function(id) {
        return apiRequest('/groups/' + id + '/members');
    }
};

var wallets = {
    getBalances: function(groupId) {
        return apiRequest('/wallets/' + groupId + '/balances');
    },
    contribute: function(groupId, data) {
        return apiRequest('/wallets/' + groupId + '/contribute', 'POST', data);
    },
    savingsDeposit: function(groupId, data) {
        return apiRequest('/wallets/' + groupId + '/savings', 'POST', data);
    },
    getTransactions: function(groupId) {
        return apiRequest('/wallets/' + groupId + '/transactions');
    }
};

var disbursement = {
    startCycle: function(groupId) {
        return apiRequest('/disbursement/' + groupId + '/start-cycle', 'POST');
    },
    assignSlots: function(groupId, cycleId) {
        return apiRequest('/disbursement/' + groupId + '/cycles/' + cycleId + '/assign-slots', 'POST');
    }
};

var payments = {
    mtnPay: function(groupId, data) {
        return apiRequest('/payments/' + groupId + '/mtn/pay', 'POST', data);
    },
    orangePay: function(groupId, data) {
        return apiRequest('/payments/' + groupId + '/orange/pay', 'POST', data);
    }
};

function goTo(page) {
    window.location.href = 'http://localhost:8080/' + page;
}

function showAlert(containerId, message, type) {
    var alertElement = document.getElementById(containerId);
    if (!alertElement) {
        return;
    }
    var icons = {
        error: '❌',
        success: '✅',
        info: 'ℹ️'
    };
    alertElement.innerHTML = '<div class="alert alert-' + (type || 'error') + '"><span>' + (icons[type] || '') + '</span><span>' + message + '</span></div>';
}

function clearAlert(containerId) {
    var alertElement = document.getElementById(containerId);
    if (alertElement) {
        alertElement.innerHTML = '';
    }
}

function formatAmount(amount) {
    return Number(amount || 0).toLocaleString() + ' XAF';
}

function formatDate(dateString) {
    if (!dateString) {
        return 'N/A';
    }
    return new Date(dateString).toLocaleDateString('fr-CM', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getInitials(name) {
    if (!name) {
        return '?';
    }
    return name.split(' ').map(function(part) {
        return part[0];
    }).join('').toUpperCase().slice(0, 2);
}

function getBadgeClass(status) {
    var map = {
        active: 'badge-active',
        new_member: 'badge-new',
        delinquent: 'badge-delinquent',
        success: 'badge-success',
        pending: 'badge-pending',
        failed: 'badge-failed',
        admin: 'badge-admin',
        suspended: 'badge-delinquent',
        exited: 'badge-failed'
    };
    return map[status] || 'badge-new';
}