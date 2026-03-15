#!/bin/bash

# run_all_tests.sh
# Execute this script from the root of the project to run all backend and frontend tests.

echo "======================================================"
echo "Starting Grader System Test Suite Execution"
echo "======================================================"

echo ""
echo "------------------------------------------------------"
echo "Running Backend Tests"
echo "------------------------------------------------------"
cd backend
npm test -- --watchAll=false
BACKEND_STATUS=$?
cd ..

echo ""
echo "------------------------------------------------------"
echo "Running Frontend Tests (Non-interactive)"
echo "------------------------------------------------------"
cd frontend
# Setting CI=true ensures Jest runs in non-interactive mode and exits after completion
CI=true npm test -- --watchAll=false
FRONTEND_STATUS=$?
cd ..

echo ""
echo "======================================================"
echo "Test Execution Summary"
echo "======================================================"

if [ $BACKEND_STATUS -eq 0 ]; then
    echo "✅ Backend Tests Passed"
else
    echo "❌ Backend Tests Failed"
fi

if [ $FRONTEND_STATUS -eq 0 ]; then
    echo "✅ Frontend Tests Passed"
else
    echo "❌ Frontend Tests Failed"
fi

if [ $BACKEND_STATUS -eq 0 ] && [ $FRONTEND_STATUS -eq 0 ]; then
    echo "🚀 All Tests Passed Successfully!"
    exit 0
else
    echo "⚠️ Some Tests Failed. Please review the logs above."
    exit 1
fi
